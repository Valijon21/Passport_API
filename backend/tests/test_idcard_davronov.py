import os
from pathlib import Path
from django.test import TestCase
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient
from rest_framework import status
from ocr_api.ocr_engine import extract_id_card, extract_id_card_full

FRONT_PATH = Path(__file__).resolve().parent.parent.parent / "pasport_img" / "card14_front.jpg"
BACK_PATH = Path(__file__).resolve().parent.parent.parent / "pasport_img" / "card14_back.jpg"


class TestIDCardDavronovTwoSidedOCR(TestCase):
    """
    Test suite for Two-Sided ID Card OCR and Anti-Fraud Cross-Validation
    for Davronov Axmadjon (AE1364469 / JSHSHIR 32404802120057).
    Verifies:
      - Front panel extracts DAVRONOV, AXMADJON, SAMIJONOVICH, AE1364469, 1980-04-24.
      - Back panel extracts JSHSHIR 32404802120057, POP TUMANI, IIV 14219, TD1 MRZ PASS.
      - Two-sided merge recognizes valid pair (different_cards_detected=False).
      - Status is VERIFIED_MATCH with 0 false fraud alerts.
      - API endpoint /api/v1/ocr/id-full/ returns 200 OK with complete citizen profile.
    """

    def setUp(self):
        self.client = APIClient()
        self.url = '/api/v1/ocr/id-full/'

    def test_front_side_extraction(self):
        if not FRONT_PATH.exists():
            self.skipTest("card14_front.jpg not found")

        with open(FRONT_PATH, 'rb') as f:
            res = extract_id_card(f.read())

        self.assertTrue(res['success'])
        sf = res['structured_fields']
        self.assertEqual(sf['document_number'], 'AE1364469')
        self.assertEqual(sf['surname'], 'DAVRONOV')
        self.assertEqual(sf['first_name'], 'AXMADJON')
        self.assertEqual(sf['patronymic'], 'SAMIJONOVICH')
        self.assertEqual(sf['birth_date'], '1980-04-24')
        self.assertEqual(sf['expiry_date'], '2035-01-24')

    def test_back_side_extraction(self):
        if not BACK_PATH.exists():
            self.skipTest("card14_back.jpg not found")

        with open(BACK_PATH, 'rb') as f:
            res = extract_id_card(f.read())

        self.assertTrue(res['success'])
        sf = res['structured_fields']
        self.assertEqual(sf['document_number'], 'AE1364469')
        self.assertEqual(sf['jshshir'], '32404802120057')
        self.assertEqual(sf['birth_place'], 'POP TUMANI')
        self.assertEqual(sf['issuing_authority'], 'IIV 14219')
        self.assertTrue(res['mrz']['mrz_detected'])
        self.assertEqual(res['mrz']['format'], 'TD1 (ID Card 3-line)')
        self.assertEqual(res['validation']['overall_status'], 'PASS')

    def test_full_two_sided_merge(self):
        if not FRONT_PATH.exists() or not BACK_PATH.exists():
            self.skipTest("card14 image files not found")

        with open(FRONT_PATH, 'rb') as f:
            f_bytes = f.read()
        with open(BACK_PATH, 'rb') as f:
            b_bytes = f.read()

        res = extract_id_card_full(f_bytes, b_bytes)

        self.assertTrue(res['success'])
        self.assertFalse(res['different_cards_detected'])
        self.assertEqual(res['validation']['overall_status'], 'VERIFIED_MATCH')
        self.assertEqual(res['validation']['fraud_alerts'], [])

        profile = res['citizen_profile']
        self.assertEqual(profile['document_number'], 'AE1364469')
        self.assertEqual(profile['personal_number'], '32404802120057')
        self.assertEqual(profile['surname'], 'DAVRONOV')
        self.assertEqual(profile['first_name'], 'AXMADJON')
        self.assertEqual(profile['patronymic'], 'SAMIJONOVICH')
        self.assertEqual(profile['full_name'], 'DAVRONOV AXMADJON SAMIJONOVICH')
        self.assertEqual(profile['date_of_birth'], '1980-04-24')
        self.assertEqual(profile['place_of_birth'], 'POP TUMANI')
        self.assertEqual(profile['issuing_authority'], 'IIV 14219')
        self.assertEqual(profile['gender'], 'Erkak')
        self.assertTrue(profile['is_valid_pair'])

    def test_api_id_full_endpoint(self):
        if not FRONT_PATH.exists() or not BACK_PATH.exists():
            self.skipTest("card14 image files not found")

        with open(FRONT_PATH, 'rb') as f:
            front_file = SimpleUploadedFile("card14_front.jpg", f.read(), content_type="image/jpeg")
        with open(BACK_PATH, 'rb') as f:
            back_file = SimpleUploadedFile("card14_back.jpg", f.read(), content_type="image/jpeg")

        resp = self.client.post(
            self.url,
            {'front_image': front_file, 'back_image': back_file},
            format='multipart'
        )

        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        data = resp.data
        self.assertTrue(data['success'])
        self.assertFalse(data['different_cards_detected'])
        self.assertEqual(data['validation']['overall_status'], 'VERIFIED_MATCH')
        self.assertEqual(data['citizen_profile']['personal_number'], '32404802120057')
        self.assertEqual(data['citizen_profile']['document_number'], 'AE1364469')
        self.assertEqual(data['citizen_profile']['surname'], 'DAVRONOV')
        self.assertEqual(data['citizen_profile']['first_name'], 'AXMADJON')
        self.assertEqual(data['citizen_profile']['patronymic'], 'SAMIJONOVICH')
