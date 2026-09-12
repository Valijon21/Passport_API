import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ocr_api.mrz_validator import (
    calculate_icao_check_digit,
    verify_icao_check_digit,
    auto_correct_mrz_field,
    cross_check_pinfl,
    validate_mrz_checksums,
    build_verification_report,
)


class TestMRZValidator(unittest.TestCase):

    def test_icao_weights_and_check_digit(self):
        # Example 1: 'AE1551318' -> Check digit calculation
        # Let's verify standard 7-3-1
        cd = calculate_icao_check_digit('AE1551318')
        self.assertTrue(cd.isdigit())
        self.assertEqual(len(cd), 1)

        # Known example: 'D23145890' -> ICAO standard check
        # '670119' (Birth date 1967-01-19):
        # 6*7=42, 7*3=21, 0*1=0, 1*7=7, 1*3=3, 9*1=9 -> 42+21+0+7+3+9 = 82 -> 82 % 10 = 2
        self.assertEqual(calculate_icao_check_digit('670119'), '2')
        self.assertTrue(verify_icao_check_digit('670119', '2'))
        self.assertFalse(verify_icao_check_digit('670119', '5'))

    def test_auto_correct_mrz_field(self):
        # Suppose OCR read '67O119' with letter 'O' instead of digit '0'
        # The true check digit for '670119' is '2'
        corrected, was_corr = auto_correct_mrz_field('67O119', '2')
        self.assertTrue(was_corr)
        self.assertEqual(corrected, '670119')

    def test_pinfl_cross_check_valid(self):
        # Male born 1967-01-19: PINFL starts with 3, date is 190167
        pinfl = '31901672180035'
        res = cross_check_pinfl(pinfl, birth_date='1967-01-19', gender='Erkak')
        self.assertTrue(res['is_valid'])
        self.assertEqual(res['status'], 'verified')
        self.assertTrue(res['birth_date_matches'])
        self.assertTrue(res['gender_matches'])
        self.assertEqual(len(res['alerts']), 0)

    def test_pinfl_cross_check_fraud_mismatch(self):
        # Tampered date: ID says 1985-05-20, but PINFL is for 1967-01-19
        pinfl = '31901672180035'
        res = cross_check_pinfl(pinfl, birth_date='1985-05-20', gender='Erkak')
        self.assertFalse(res['is_valid'])
        self.assertFalse(res['birth_date_matches'])
        self.assertIn('mismatch_detected', res['status'])
        self.assertGreater(len(res['alerts']), 0)

    def test_pinfl_gender_mismatch(self):
        # PINFL starts with 3 (Male), but gender is 'Ayol'
        pinfl = '31901672180035'
        res = cross_check_pinfl(pinfl, birth_date='1967-01-19', gender='Ayol')
        self.assertFalse(res['is_valid'])
        self.assertFalse(res['gender_matches'])
        self.assertGreater(len(res['alerts']), 0)

    def test_pinfl_not_applicable_for_id_front(self):
        res = cross_check_pinfl(None, birth_date='1989-03-29', gender='Erkak')
        self.assertEqual(res['status'], 'not_applicable')
        self.assertTrue(res['is_valid'])
        self.assertEqual(len(res['alerts']), 0)

    def test_td1_mrz_validation(self):
        # TD1 lines from actual card2.png
        l1 = "I1UZBAE1551318631901672180055<"
        l2 = "6701192M3502077UZBTJK<<<<<<<<6"
        l3 = "MARUPOV<<ZOKIRJON<<<<<<<<<<<<<"
        mrz_data = {'format': 'TD1 (ID Card 3-line)'}
        res = validate_mrz_checksums(mrz_data, [l1, l2, l3])
        self.assertTrue(res['has_mrz'])
        # Birth date 670119 check digit 2
        self.assertTrue(res['birth_date_valid'])


if __name__ == '__main__':
    unittest.main()
