"""
ICAO 9303 MRZ Check Digit Engine & PINFL Cross-Verification Engine
===================================================================
Standard 7-3-1 weighting checksum verification, OCR auto-correction,
and Uzbek PINFL (JSHSHIR) cross-validation for high-security KYC.
"""

import re
from typing import Dict, Any, List, Optional, Tuple


# ──────────────────────────────────────────────────────────────────────────────
# 1. ICAO 9303 CHARACTER VALUES & WEIGHTS
# ──────────────────────────────────────────────────────────────────────────────

ICAO_WEIGHTS = [7, 3, 1]

# Typical OCR substitution confusion pairs
CONFUSION_MAP = {
    '0': ['O', 'Q', 'D', 'U'],
    'O': ['0', 'Q', 'D'],
    '1': ['I', 'L', '|', 'T'],
    'I': ['1', 'L', '|'],
    'L': ['1', 'I'],
    '2': ['Z'],
    'Z': ['2'],
    '5': ['S'],
    'S': ['5'],
    '8': ['B'],
    'B': ['8'],
    '6': ['G', 'b'],
    'G': ['6'],
}


def char_value(c: str) -> int:
    """Return numeric value according to ICAO 9303 standard."""
    c = c.upper()
    if '0' <= c <= '9':
        return int(c)
    if 'A' <= c <= 'Z':
        return ord(c) - 55  # 'A' -> 10, 'Z' -> 35
    if c == '<':
        return 0
    return 0


def calculate_icao_check_digit(data: str) -> str:
    """Calculate single-digit check sum using repeating [7, 3, 1] weights."""
    if not data:
        return '0'
    total = 0
    for i, ch in enumerate(data):
        w = ICAO_WEIGHTS[i % 3]
        total += char_value(ch) * w
    return str(total % 10)


def verify_icao_check_digit(data: str, expected_digit: str) -> bool:
    """Verify if expected_digit matches calculated check digit."""
    if not expected_digit or len(expected_digit) != 1 or not expected_digit.isdigit():
        return False
    return calculate_icao_check_digit(data) == str(expected_digit)


def auto_correct_mrz_field(raw_field: str, expected_digit: str) -> Tuple[str, bool]:
    """
    Attempt to correct common OCR errors if check digit fails.
    Returns (corrected_str, was_corrected).
    """
    if not raw_field or not expected_digit or not expected_digit.isdigit():
        return raw_field, False

    # If already valid, nothing to correct
    if calculate_icao_check_digit(raw_field) == expected_digit:
        return raw_field, False

    # Try single-character substitution
    field_chars = list(raw_field.upper())
    for idx, ch in enumerate(field_chars):
        alternatives = CONFUSION_MAP.get(ch, [])
        for alt in alternatives:
            candidate_chars = list(field_chars)
            candidate_chars[idx] = alt
            cand_str = "".join(candidate_chars)
            if calculate_icao_check_digit(cand_str) == expected_digit:
                return cand_str, True

    # No valid substitution found
    return raw_field, False


# ──────────────────────────────────────────────────────────────────────────────
# 2. MRZ CHECKSUM VERIFICATION (TD1 & TD3)
# ──────────────────────────────────────────────────────────────────────────────

def validate_mrz_checksums(mrz_data: Optional[Dict[str, Any]], raw_lines: Optional[List[str]] = None) -> Dict[str, Any]:
    """
    Perform full ICAO 9303 checksum verification on TD1 (ID cards) or TD3 (passports).
    """
    result: Dict[str, Any] = {
        'format': None,
        'has_mrz': False,
        'all_passed': False,
        'document_number_valid': None,
        'birth_date_valid': None,
        'expiry_date_valid': None,
        'composite_valid': None,
        'auto_corrections_applied': [],
        'details': {}
    }

    if not mrz_data or not raw_lines or len(raw_lines) < 2:
        return result

    result['has_mrz'] = True
    fmt = mrz_data.get('format', '')
    result['format'] = fmt

    # Clean lines
    lines = [re.sub(r'[\s]+', '', l).upper() for l in raw_lines if l.strip()]

    # ── TD1 (ID Card: 3 lines x 30 chars) ─────────────────────────────────────
    if 'TD1' in fmt or len(lines) >= 3:
        # Find 3 contiguous lines suitable for TD1
        td1_lines = None
        for i in range(len(lines) - 2):
            l1, l2, l3 = lines[i], lines[i+1], lines[i+2]
            if (l1.startswith(('I', '1', 'A', 'C', 'IT', 'IU')) or 'UZB' in l1[:8]) and len(l1) >= 20:
                td1_lines = (l1, l2, l3)
                break

        if td1_lines:
            l1, l2, l3 = td1_lines
            # Pad to 30 chars if slight crop
            l1 = l1.ljust(30, '<')
            l2 = l2.ljust(30, '<')
            l3 = l3.ljust(30, '<')

            # 1. Document Number Checksum (Line 1: chars 5:14, check digit at 14)
            raw_doc = l1[5:14]
            doc_cd = l1[14] if len(l1) > 14 and l1[14].isdigit() else None
            if doc_cd:
                corrected_doc, was_corr = auto_correct_mrz_field(raw_doc, doc_cd)
                if was_corr:
                    result['auto_corrections_applied'].append(f"DocNum '{raw_doc}' -> '{corrected_doc}'")
                    raw_doc = corrected_doc
                result['document_number_valid'] = verify_icao_check_digit(raw_doc, doc_cd)
                result['details']['doc_check'] = {'data': raw_doc, 'check_digit': doc_cd, 'valid': result['document_number_valid']}

            # 2. Birth Date Checksum (Line 2: chars 0:6, check digit at 6)
            raw_birth = l2[0:6]
            birth_cd = l2[6] if len(l2) > 6 and l2[6].isdigit() else None
            if birth_cd:
                corrected_birth, was_corr = auto_correct_mrz_field(raw_birth, birth_cd)
                if was_corr:
                    result['auto_corrections_applied'].append(f"BirthDate '{raw_birth}' -> '{corrected_birth}'")
                    raw_birth = corrected_birth
                result['birth_date_valid'] = verify_icao_check_digit(raw_birth, birth_cd)
                result['details']['birth_check'] = {'data': raw_birth, 'check_digit': birth_cd, 'valid': result['birth_date_valid']}

            # 3. Expiry Date Checksum (Line 2: chars 8:14, check digit at 14)
            raw_expiry = l2[8:14]
            expiry_cd = l2[14] if len(l2) > 14 and l2[14].isdigit() else None
            if expiry_cd:
                corrected_exp, was_corr = auto_correct_mrz_field(raw_expiry, expiry_cd)
                if was_corr:
                    result['auto_corrections_applied'].append(f"ExpiryDate '{raw_expiry}' -> '{corrected_exp}'")
                    raw_expiry = corrected_exp
                result['expiry_date_valid'] = verify_icao_check_digit(raw_expiry, expiry_cd)
                result['details']['expiry_check'] = {'data': raw_expiry, 'check_digit': expiry_cd, 'valid': result['expiry_date_valid']}

            # 4. Composite Checksum (Line 2: char 29)
            if len(l2) >= 30 and l2[29].isdigit():
                composite_data = l1[5:30] + l2[0:7] + l2[8:15] + l2[18:29]
                comp_cd = l2[29]
                result['composite_valid'] = verify_icao_check_digit(composite_data, comp_cd)

            # Overall pass: if tested fields passed
            tested = [v for v in [result['document_number_valid'], result['birth_date_valid'], result['expiry_date_valid']] if v is not None]
            result['all_passed'] = bool(tested and all(tested))
            return result

    # ── TD3 (Passport: 2 lines x 44 chars) ────────────────────────────────────
    if 'TD3' in fmt or len(lines) >= 2:
        td3_line2 = None
        for l in lines:
            if len(l) >= 30 and bool(re.match(r'^[A-Z0-9<]{30,44}$', l)):
                # Passport Line 2 starts with doc number or contains UZB anchor with birth date
                if re.match(r'^[A-Z]{2}\d{7}', l) or ('UZB' in l and bool(re.search(r'\d{6}', l))):
                    td3_line2 = l
                    break

        if td3_line2:
            # If td3_line2 had the initial letter trimmed (e.g. B70480240UZB...), align using mrz_data doc_num
            target_doc = mrz_data.get('document_number') if mrz_data else None
            if target_doc and len(target_doc) == 9 and not td3_line2.startswith(target_doc):
                if td3_line2.startswith(target_doc[1:]):
                    td3_line2 = target_doc[0] + td3_line2
            elif 'UZB' in td3_line2 and td3_line2.find('UZB') == 9 and len(td3_line2) == 43:
                prefix = target_doc[0] if (target_doc and len(target_doc) == 9) else 'A'
                td3_line2 = prefix + td3_line2

            l2 = td3_line2.ljust(44, '<')

            # 1. Document Number Checksum (chars 0:9, check digit at 9)
            raw_doc = l2[0:9]
            doc_cd = l2[9] if l2[9].isdigit() else None
            if doc_cd:
                corrected_doc, was_corr = auto_correct_mrz_field(raw_doc, doc_cd)
                if was_corr:
                    result['auto_corrections_applied'].append(f"DocNum '{raw_doc}' -> '{corrected_doc}'")
                    raw_doc = corrected_doc
                result['document_number_valid'] = verify_icao_check_digit(raw_doc, doc_cd)
                result['details']['doc_check'] = {'data': raw_doc, 'check_digit': doc_cd, 'valid': result['document_number_valid']}

            # 2. Birth Date Checksum (chars 13:19, check digit at 19)
            raw_birth = l2[13:19]
            birth_cd = l2[19] if l2[19].isdigit() else None
            if birth_cd:
                corrected_birth, was_corr = auto_correct_mrz_field(raw_birth, birth_cd)
                if was_corr:
                    result['auto_corrections_applied'].append(f"BirthDate '{raw_birth}' -> '{corrected_birth}'")
                    raw_birth = corrected_birth
                result['birth_date_valid'] = verify_icao_check_digit(raw_birth, birth_cd)
                result['details']['birth_check'] = {'data': raw_birth, 'check_digit': birth_cd, 'valid': result['birth_date_valid']}

            # 3. Expiry Date Checksum (chars 21:27, check digit at 27)
            raw_exp = l2[21:27]
            exp_cd = l2[27] if l2[27].isdigit() else None
            if exp_cd:
                corrected_exp, was_corr = auto_correct_mrz_field(raw_exp, exp_cd)
                if was_corr:
                    result['auto_corrections_applied'].append(f"ExpiryDate '{raw_exp}' -> '{corrected_exp}'")
                    raw_exp = corrected_exp
                result['expiry_date_valid'] = verify_icao_check_digit(raw_exp, exp_cd)
                result['details']['expiry_check'] = {'data': raw_exp, 'check_digit': exp_cd, 'valid': result['expiry_date_valid']}

            # 4. Optional Data / Personal Number Checksum (chars 28:42, check digit at 42)
            raw_pn = l2[28:42]
            pn_cd = l2[42] if l2[42].isdigit() else None
            if pn_cd:
                result['details']['personal_number_valid'] = verify_icao_check_digit(raw_pn, pn_cd)

            # 5. Composite Checksum (char 43)
            if l2[43].isdigit():
                composite_data = l2[0:10] + l2[13:20] + l2[21:43]
                result['composite_valid'] = verify_icao_check_digit(composite_data, l2[43])

            tested = [v for v in [result['document_number_valid'], result['birth_date_valid'], result['expiry_date_valid']] if v is not None]
            result['all_passed'] = bool(tested and all(tested))
            return result

    return result


# ──────────────────────────────────────────────────────────────────────────────
# 3. UZBEKISTAN JSHSHIR (PINFL) CROSS-VERIFICATION
# ──────────────────────────────────────────────────────────────────────────────

def cross_check_pinfl(
    pinfl: Optional[str],
    birth_date: Optional[str],
    gender: Optional[str]
) -> Dict[str, Any]:
    """
    Cross-verify 14-digit Uzbekistan PINFL (JSHSHIR) against parsed birth_date and gender.

    PINFL Structure (14 digits):
      Digit 1: Century & Gender
        1: 1800-1899 Male
        2: 1800-1899 Female
        3: 1900-1999 Male
        4: 1900-1999 Female
        5: 2000-2099 Male
        6: 2000-2099 Female
      Digits 2-7: Date of birth (DDMMYY)
        2-3: Day (01-31)
        4-5: Month (01-12)
        6-7: Year (00-99)
      Digits 8-10: District / Region code
      Digits 11-13: Serial number
      Digit 14: Control checksum
    """
    res: Dict[str, Any] = {
        'status': 'not_applicable',
        'is_valid': True,
        'birth_date_matches': None,
        'gender_matches': None,
        'pinfl_parsed': None,
        'alerts': []
    }

    if not pinfl:
        res['status'] = 'not_applicable'
        res['reason'] = "JSHSHIR (PINFL) hujjatda mavjud emas (ID karta old tomoni yoki topilmadi)"
        return res

    clean_pinfl = re.sub(r'[\s-]+', '', str(pinfl))
    if len(clean_pinfl) != 14 or not clean_pinfl.isdigit():
        res['status'] = 'invalid_format'
        res['is_valid'] = False
        res['alerts'].append(f"JSHSHIR formati noto'g'ri: 14 ta raqam bo'lishi shart, olingan: '{clean_pinfl}'")
        return res

    lead_digit = clean_pinfl[0]
    if lead_digit not in '123456':
        res['status'] = 'invalid_lead_digit'
        res['is_valid'] = False
        res['alerts'].append(f"JSHSHIR 1-raqami 1..6 orasida bo'lishi kerak, olingan: '{lead_digit}'")
        return res

    # ── Parse PINFL Attributes ────────────────────────────────────────────────
    gender_map = {
        '1': ('Erkak', 1800),
        '2': ('Ayol', 1800),
        '3': ('Erkak', 1900),
        '4': ('Ayol', 1900),
        '5': ('Erkak', 2000),
        '6': ('Ayol', 2000),
    }
    pinfl_gender, century = gender_map[lead_digit]

    day = int(clean_pinfl[1:3])
    month = int(clean_pinfl[3:5])
    yy = int(clean_pinfl[5:7])

    if not (1 <= day <= 31 and 1 <= month <= 12):
        res['status'] = 'invalid_date_component'
        res['is_valid'] = False
        res['alerts'].append(f"JSHSHIR ichidagi tug'ilgan sana yaroqsiz: Kun={day:02d}, Oy={month:02d}")
        return res

    full_year = century + yy
    pinfl_birth_date = f"{full_year:04d}-{month:02d}-{day:02d}"

    res['pinfl_parsed'] = {
        'gender': pinfl_gender,
        'century': f"{century}s",
        'birth_date': pinfl_birth_date,
    }

    # ── Cross-Check: Birth Date ───────────────────────────────────────────────
    if birth_date:
        clean_bd = str(birth_date).strip()
        # Expecting YYYY-MM-DD
        if re.match(r'^\d{4}-\d{2}-\d{2}$', clean_bd):
            if clean_bd == pinfl_birth_date:
                res['birth_date_matches'] = True
            else:
                res['birth_date_matches'] = False
                res['is_valid'] = False
                res['alerts'].append(
                    f"Tug'ilgan sana nomuvofiqligi: OCR='{clean_bd}' vs JSHSHIR='{pinfl_birth_date}'"
                )
        else:
            res['birth_date_matches'] = None

    # ── Cross-Check: Gender ───────────────────────────────────────────────────
    if gender:
        g_clean = str(gender).strip().lower()
        expected_g = pinfl_gender.lower()
        if 'erkak' in g_clean or 'male' in g_clean or g_clean == 'm':
            curr_g = 'erkak'
        elif 'ayol' in g_clean or 'female' in g_clean or g_clean == 'f':
            curr_g = 'ayol'
        else:
            curr_g = None

        if curr_g:
            if curr_g == expected_g:
                res['gender_matches'] = True
            else:
                res['gender_matches'] = False
                res['is_valid'] = False
                res['alerts'].append(
                    f"Jins nomuvofiqligi: OCR='{gender}' vs JSHSHIR 1-raqami='{pinfl_gender}'"
                )

    if res['is_valid'] and (res['birth_date_matches'] or res['gender_matches']):
        res['status'] = 'verified'
    elif not res['is_valid']:
        res['status'] = 'mismatch_detected'
    else:
        res['status'] = 'partially_verified'

    return res


# ──────────────────────────────────────────────────────────────────────────────
# 4. UNIFIED VERIFICATION REPORT
# ──────────────────────────────────────────────────────────────────────────────

def build_verification_report(
    structured_fields: Dict[str, Any],
    mrz_data: Optional[Dict[str, Any]],
    raw_mrz_lines: Optional[List[str]] = None
) -> Dict[str, Any]:
    """
    Build unified security and authenticity report.
    Returns:
      is_authentic: bool
      overall_status: 'PASS' | 'WARN' | 'FAIL' | 'NOT_APPLICABLE'
      mrz_checksums: Dict
      pinfl_cross_check: Dict
      fraud_alerts: List[str]
    """
    mrz_check = validate_mrz_checksums(mrz_data, raw_mrz_lines)
    pinfl = structured_fields.get('jshshir')
    birth_date = structured_fields.get('birth_date')
    gender = structured_fields.get('gender')

    pinfl_check = cross_check_pinfl(pinfl, birth_date, gender)

    fraud_alerts: List[str] = []
    fraud_alerts.extend(pinfl_check.get('alerts', []))

    # MRZ checksum alerts
    if mrz_check.get('has_mrz'):
        if mrz_check.get('document_number_valid') is False:
            fraud_alerts.append("MRZ nazorat raqami nomuvofiq: Hujjat raqami tekshiruvdan o'tmadi")
        if mrz_check.get('birth_date_valid') is False:
            fraud_alerts.append("MRZ nazorat raqami nomuvofiq: Tug'ilgan sana tekshiruvdan o'tmadi")
        if mrz_check.get('expiry_date_valid') is False:
            fraud_alerts.append("MRZ nazorat raqami nomuvofiq: Amal qilish muddati tekshiruvdan o'tmadi")

    # Determine overall status
    if fraud_alerts:
        overall_status = 'FAIL' if any('nomuvofiqligi' in a or 'yaroqsiz' in a for a in fraud_alerts) else 'WARN'
        is_authentic = False
    elif mrz_check.get('all_passed') or pinfl_check.get('status') == 'verified':
        overall_status = 'PASS'
        is_authentic = True
    else:
        overall_status = 'NOT_APPLICABLE' if not mrz_check.get('has_mrz') and not pinfl else 'PASS'
        is_authentic = True

    return {
        'is_authentic': is_authentic,
        'overall_status': overall_status,
        'mrz_checksums': mrz_check,
        'pinfl_cross_check': pinfl_check,
        'fraud_alerts': fraud_alerts,
        'auto_corrections_applied': mrz_check.get('auto_corrections_applied', [])
    }
