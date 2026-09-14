import os
from pathlib import Path
from django.test import TestCase
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient
from rest_framework import status
from ocr_api.ocr_engine import extract_id_card

IMG_PATH = Path(__file__).resolve().parent.parent.parent / "pasport_img" / "card13_passport.png"


class TestBiometricPassportPulatjonovaOCR(TestCase):
    """
    Test suite for Biometric Passport OCR (Pulatjonova Mukhlisa / AB7048024).
    Verifies:
      - Clean MRZ detection with TD3 2-line structure
      - Correct 14-digit JSHSHIR (62206015910037)
      - Native Uzbek name extraction (PO'LATJONOVA MUXLISA O'TKIRJON QIZI)
      - No label noise (e.g. rejection of 'RESS' or corrupted authority)
      - 100% ICAO 9303 checksum validation pass
      - Full REST API /api/v1/ocr/id/ integration
    """

    def setUp(self):
        self.client = APIClient()
        self.url = '/api/v1/ocr/id/'

    def test_direct_engine_extraction(self):
        if not IMG_PATH.exists():
            self.skipTest("card13_passport.png not found")

        with open(IMG_PATH, 'rb') as f:
            res = extract_id_card(f.read())

        self.assertTrue(res['success'])
        sf = res['structured_fields']
        val = res['validation']

        self.assertEqual(sf['document_number'], 'AB7048024')
        self.assertEqual(sf['jshshir'], '62206015910037')
        self.assertIn(sf['surname'], ["PO'LATJONOVA", "PULATJONOVA"])
        self.assertIn(sf['first_name'], ["MUXLISA", "MUKHLISA"])
        self.assertNotEqual(sf['first_name'], 'RESS')
        self.assertEqual(sf['patronymic'], "O'TKIRJON QIZI")
        self.assertEqual(sf['birth_date'], '2001-06-22')
        self.assertEqual(sf['expiry_date'], '2027-06-27')
        self.assertEqual(sf['gender'], 'Ayol')
        self.assertEqual(sf['birth_place'], 'POP TUMANI')
        self.assertIn('POP TUMANI IIB', sf['issuing_authority'])

        self.assertTrue(res['mrz']['mrz_detected'])
        self.assertEqual(res['mrz']['format'], 'TD3 (Passport 2-line)')
        self.assertEqual(val['overall_status'], 'PASS')
        self.assertTrue(val['mrz_checksums']['all_passed'])
        self.assertTrue(val['pinfl_cross_check']['is_valid'])

    def test_api_endpoint_extraction(self):
        if not IMG_PATH.exists():
            self.skipTest("card13_passport.png not found")

        with open(IMG_PATH, 'rb') as f:
            img_file = SimpleUploadedFile("card13_passport.png", f.read(), content_type="image/png")

        resp = self.client.post(self.url, {'image': img_file, 'doc_type': 'auto'}, format='multipart')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        data = resp.data

        self.assertTrue(data['success'])
        sf = data['structured_fields']
        self.assertEqual(sf['document_number'], 'AB7048024')
        self.assertEqual(sf['jshshir'], '62206015910037')
        self.assertNotEqual(sf['first_name'], 'RESS')
        self.assertEqual(sf['first_name'], 'MUXLISA')
        self.assertEqual(sf['surname'], "PO'LATJONOVA")
        self.assertEqual(data['validation']['overall_status'], 'PASS')
