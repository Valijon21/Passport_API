import os
import io
from pathlib import Path
from django.test import TestCase
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient
from rest_framework import status

IMG_DIR = Path(__file__).resolve().parent.parent.parent / "pasport_img"


class TestIDCardFullOCR(TestCase):
    """
    Test suite for Two-Sided ID Card Smart Merge (POST /api/v1/ocr/id-full/).
    Verifies:
      - Validations (missing/invalid files)
      - Smart Auto-Swap (reversed upload handling)
      - Authentic pair merge and 100% complete citizen profile
      - Anti-fraud mismatch detection when front and back belong to different citizens
    """

    def setUp(self):
        self.client = APIClient()
        self.url = '/api/v1/ocr/id-full/'

    def test_missing_files_validation(self):
        """Request without front or back images should return 400."""
        response = self.client.post(self.url, {}, format='multipart')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('front_image', response.data['details'])
        self.assertIn('back_image', response.data['details'])

    def test_invalid_content_type(self):
        """Non-image files should be rejected with 400."""
        fake_file = SimpleUploadedFile("test.txt", b"plain text content", content_type="text/plain")
        response = self.client.post(self.url, {
            'front_image': fake_file,
            'back_image': fake_file
        }, format='multipart')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_card4_card5_smart_merge_normal_order(self):
        """Card4 (front) + Card5 (back) should produce complete verified citizen profile."""
        card4_path = IMG_DIR / "card4.jpg"
        card5_path = IMG_DIR / "card5.jpg"
        if not card4_path.exists() or not card5_path.exists():
            self.skipTest("Sample images card4.jpg/card5.jpg not found in pasport_img")

        with open(card4_path, 'rb') as f_front, open(card5_path, 'rb') as f_back:
            front_file = SimpleUploadedFile("card4.jpg", f_front.read(), content_type="image/jpeg")
            back_file = SimpleUploadedFile("card5.jpg", f_back.read(), content_type="image/jpeg")

        response = self.client.post(self.url, {
            'front_image': front_file,
            'back_image': back_file
        }, format='multipart')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.data
        self.assertTrue(data['success'])
        self.assertFalse(data['auto_swapped'])
        self.assertEqual(data['document_type'], 'ID_CARD')

        profile = data['citizen_profile']
        self.assertEqual(profile['document_number'], 'AD8572239')
        self.assertEqual(profile['personal_number'], '32903892180078')
        self.assertEqual(profile['surname'], 'YULDASHOV')
        self.assertEqual(profile['first_name'], 'ABDUBAKIR')
        self.assertEqual(profile['patronymic'], 'ABDULAXATOVICH')
        self.assertEqual(profile['full_name'], 'YULDASHOV ABDUBAKIR ABDULAXATOVICH')
        self.assertEqual(profile['date_of_birth'], '1989-03-29')
        self.assertEqual(profile['gender'], 'Erkak')
        self.assertTrue(profile['place_of_birth'] and 'CHUST' in profile['place_of_birth'])

        # Face biometric check
        self.assertTrue(data['face']['detected'])
        self.assertIsNotNone(data['face']['image_base64'])

        # Validation check
        val = data['validation']
        self.assertEqual(val['overall_status'], 'VERIFIED_MATCH')
        self.assertTrue(val['is_authentic'])
        self.assertGreaterEqual(val['match_score'], 90.0)
        self.assertEqual(val['checks']['document_number_match']['status'], 'MATCH')

    def test_smart_auto_swap_reversed_order(self):
        """Uploading Card5 as front and Card4 as back should auto-swap correctly."""
        card4_path = IMG_DIR / "card4.jpg"
        card5_path = IMG_DIR / "card5.jpg"
        if not card4_path.exists() or not card5_path.exists():
            self.skipTest("Sample images not found")

        with open(card5_path, 'rb') as f_back, open(card4_path, 'rb') as f_front:
            # Deliberately reversed
            reversed_front = SimpleUploadedFile("card5.jpg", f_back.read(), content_type="image/jpeg")
            reversed_back = SimpleUploadedFile("card4.jpg", f_front.read(), content_type="image/jpeg")

        response = self.client.post(self.url, {
            'front_image': reversed_front,
            'back_image': reversed_back
        }, format='multipart')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.data
        self.assertTrue(data['success'])
        self.assertTrue(data['auto_swapped'])

        profile = data['citizen_profile']
        self.assertEqual(profile['document_number'], 'AD8572239')
        self.assertEqual(profile['surname'], 'YULDASHOV')
        self.assertEqual(profile['first_name'], 'ABDUBAKIR')

    def test_anti_fraud_mismatched_sides(self):
        """Card4 (Yuldashov) + Card3 (Turdiyev) must trigger Anti-Fraud mismatch alert."""
        card4_path = IMG_DIR / "card4.jpg"
        card3_path = IMG_DIR / "card3.jpg"
        if not card4_path.exists() or not card3_path.exists():
            self.skipTest("Sample images not found")

        with open(card4_path, 'rb') as f4, open(card3_path, 'rb') as f3:
            front_file = SimpleUploadedFile("card4.jpg", f4.read(), content_type="image/jpeg")
            mismatched_back = SimpleUploadedFile("card3.jpg", f3.read(), content_type="image/jpeg")

        response = self.client.post(self.url, {
            'front_image': front_file,
            'back_image': mismatched_back
        }, format='multipart')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.data
        val = data['validation']
        self.assertFalse(val['is_authentic'])
        self.assertEqual(val['overall_status'], 'SUSPECTED_FRAUD')
        self.assertGreater(len(val['fraud_alerts']), 0)
        self.assertEqual(val['checks']['document_number_match']['status'], 'MISMATCH')
