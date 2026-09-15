import os
from pathlib import Path
from django.test import TestCase
from ocr_api.ocr_engine import extract_id_card

CARD15_PATH = Path(r"C:\Users\nout.plus\Pictures\card15.jpg")


class TestPassportCard15OCR(TestCase):
    """
    Test suite for Uzbekistan Biometric Passport OCR (Ruziboeva Xusniya Abdusoxid qizi).
    Verifies:
      - Accurate 14-digit JSHSHIR (62903005910069) without dropping zeros or capturing check digit.
      - Accurate MRZ TD3 first name extraction (XUSNIYA) without body noise override ('AIRE').
      - Accurate birth date (2000-03-29) verified against JSHSHIR century & check digit, not mutated to 1980.
      - Accurate issue date (2017-04-10) deduplicated from bilingual birth dates and matching 10-year adult validity.
      - Accurate document number (AB6460702), gender (Ayol), expiry (2027-04-09).
      - Issuing authority: NAMANGAN VILOYATI POP TUMANI IIB.
      - Birth place: POP TUMANI.
    """

    def test_card15_passport_extraction(self):
        if not CARD15_PATH.exists():
            self.skipTest(f"{CARD15_PATH} not found")

        with open(CARD15_PATH, 'rb') as f:
            res = extract_id_card(f.read(), doc_type='auto')

        self.assertTrue(res['success'])
        cp = res['citizen_profile']
        
        self.assertEqual(cp['document_type'], 'PASSPORT')
        self.assertEqual(cp['document_number'], 'AB6460702')
        self.assertEqual(cp['personal_number'], '62903005910069')
        self.assertEqual(cp['surname'], 'RUZIBOEVA')
        self.assertIn(cp['first_name'], ['XUSNIYA', 'KHUSNIYA'])
        self.assertNotEqual(cp['first_name'], 'AIRE')
        self.assertEqual(cp['patronymic'], 'ABDUSOXID QIZI')
        self.assertEqual(cp['date_of_birth'], '2000-03-29')
        self.assertEqual(cp['date_of_issue'], '2017-04-10')
        self.assertEqual(cp['date_of_expiry'], '2027-04-09')
        self.assertEqual(cp['gender'], 'Ayol')
        self.assertEqual(cp['nationality'], "O'zbekiston")
        self.assertEqual(cp['place_of_birth'], 'POP TUMANI')
        self.assertEqual(cp['issuing_authority'], 'NAMANGAN VILOYATI POP TUMANI IIB')

        # Security & Validation check
        val = res.get('validation', {})
        self.assertEqual(val.get('overall_status'), 'PASS')
        self.assertTrue(val.get('is_authentic'))
