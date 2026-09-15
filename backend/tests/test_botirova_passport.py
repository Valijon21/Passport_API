import os
from pathlib import Path
from django.test import TestCase
from ocr_api.ocr_engine import extract_id_card

CARD13_PATH = Path(r"C:\Users\nout.plus\Pictures\card13.jpg")


class TestPassportBotirovaOCR(TestCase):
    """
    Test suite for Uzbekistan Biometric Passport OCR (Botirova Mohira Toshmirzayevna).
    Verifies:
      - Clean MRZ TD3 extraction and name separation (BOTIROVA, MOHIRA).
      - No chevron noise (BOTIROVAS -> BOTIROVA, NOHIRASS -> MOHIRA).
      - Accurate 14-digit JSHSHIR with auto-correction for pen stroke on digit 2.
      - Birth date, expiry date (10-year adult validity), gender (Ayol), nationality (O'zbekiston).
      - Clean issuing authority (STATE PERSONALIZATION CENTRE) without header bleed.
      - Clean birth place (NAMANGAN VILOYATI) without guilloche noise (no БУ: ВЕК 5).
    """

    def test_botirova_passport_extraction(self):
        if not CARD13_PATH.exists():
            self.skipTest(f"{CARD13_PATH} not found")

        with open(CARD13_PATH, 'rb') as f:
            res = extract_id_card(f.read(), doc_type='auto')

        self.assertTrue(res['success'])
        cp = res['citizen_profile']
        
        self.assertEqual(cp['document_type'], 'PASSPORT')
        self.assertEqual(cp['document_number'], 'AB9554300')
        self.assertEqual(cp['personal_number'], '42107852210028')
        self.assertEqual(cp['surname'], 'BOTIROVA')
        self.assertEqual(cp['first_name'], 'MOHIRA')
        self.assertEqual(cp['patronymic'], 'TOSHMIRZAYEVNA')
        self.assertEqual(cp['full_name'], 'BOTIROVA MOHIRA TOSHMIRZAYEVNA')
        self.assertEqual(cp['date_of_birth'], '1985-07-21')
        self.assertEqual(cp['date_of_expiry'], '2028-05-14')
        self.assertEqual(cp['gender'], 'Ayol')
        self.assertEqual(cp['nationality'], "O'zbekiston")
        self.assertEqual(cp['issuing_authority'], 'STATE PERSONALIZATION CENTRE')
        self.assertNotIn('BEK', cp['place_of_birth'])
        self.assertNotIn(':', cp['place_of_birth'])
