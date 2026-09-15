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
    '0': ['O', 'Q', 'D', 'U', '8', '6'],
    'O': ['0', 'Q', 'D'],
    'Q': ['0', 'O'],
    'D': ['0', 'O'],
    'U': ['0'],
    '1': ['I', 'L', '|', 'T', '7'],
    'I': ['1', 'L', '|', 'T'],
    'L': ['1', 'I'],
    '|': ['1', 'I'],
    'T': ['1', '7', 'I'],
    '7': ['1', 'T'],
    '2': ['Z', '4', '7'],
    'Z': ['2', '7'],
    '3': ['5', '8', 'E'],
    '4': ['2', 'A', '6'],
    'A': ['4'],
    '5': ['S', '3', '6'],
    'S': ['5'],
    '8': ['B', '3', '0'],
    'B': ['8'],
    '6': ['G', 'b', '4', '0', '5'],
    'G': ['6'],
    'b': ['6'],
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


def normalize_mrz_doc_chars(doc_str: str) -> str:
    """Normalize Uzbek document number: positions 0-1 must be letters, positions 2-8 must be digits."""
    if not doc_str or len(doc_str) != 9:
        return doc_str or ""
    chars = list(doc_str.upper())
    d2l_0 = {'4': 'A', '0': 'O', '1': 'I', '8': 'B', '2': 'Z', '5': 'S', '7': 'T'}
    d2l_1 = {'4': 'A', '0': 'O', '1': 'I', '8': 'B', '2': 'Z', '5': 'S', '7': 'T', '3': 'E'}
    if chars[0].isdigit() and chars[0] in d2l_0:
        chars[0] = d2l_0[chars[0]]
    if chars[1].isdigit() and chars[1] in d2l_1:
        chars[1] = d2l_1[chars[1]]
    l2d = {'O': '0', 'D': '0', 'Q': '0', 'I': '1', 'L': '1', 'T': '1', 'Z': '2', 'B': '8', 'S': '5', 'G': '6', 'A': '4'}
    for idx in range(2, 9):
        if chars[idx].isalpha() and chars[idx] in l2d:
            chars[idx] = l2d[chars[idx]]
    return "".join(chars)


def auto_correct_mrz_field(raw_field: str, expected_digit: str) -> Tuple[str, bool]:
    """
    Attempt to correct common OCR errors if check digit fails.
    Returns (corrected_str, was_corrected).
    """
    if not raw_field or not expected_digit or not expected_digit.isdigit():
        return raw_field, False

    # Normalize candidate if it's a 9-char doc number
    if len(raw_field) == 9:
        norm_field = normalize_mrz_doc_chars(raw_field)
        if calculate_icao_check_digit(norm_field) == expected_digit:
            return norm_field, (norm_field != raw_field)
        raw_field = norm_field

    # If already valid, nothing to correct
    if calculate_icao_check_digit(raw_field) == expected_digit:
        return raw_field, False

    field_chars = list(raw_field.upper())

    # Special heuristic for Uzbek Doc Numbers: 2 letters + 7 digits (e.g. AET364469 -> AE1364469)
    if len(field_chars) == 9:
        d2l_0 = {'4': 'A', '0': 'O', '1': 'I', '8': 'B', '2': 'Z', '5': 'S', '7': 'T'}
        d2l_1 = {'4': 'A', '0': 'O', '1': 'I', '8': 'B', '2': 'Z', '5': 'S', '7': 'T', '3': 'E'}
        letter_to_digit = {'T': '1', 'I': '1', 'L': '1', 'O': '0', 'D': '0', 'Z': '2', 'S': '5', 'B': '8', 'G': '6', 'A': '4'}
        cand = list(field_chars)
        changed = False
        if cand[0].isdigit() and cand[0] in d2l_0:
            cand[0] = d2l_0[cand[0]]
            changed = True
        if cand[1].isdigit() and cand[1] in d2l_1:
            cand[1] = d2l_1[cand[1]]
            changed = True
        for idx in range(2, 9):
            if cand[idx].isalpha() and cand[idx] in letter_to_digit:
                cand[idx] = letter_to_digit[cand[idx]]
                changed = True
        if changed and calculate_icao_check_digit("".join(cand)) == expected_digit:
            return "".join(cand), True

    # Special heuristic for 6-digit Date fields (YYMMDD): all 6 chars must be digits
    if len(field_chars) == 6 and any(c.isalpha() for c in field_chars):
        letter_to_digit = {'O': '0', 'D': '0', 'Q': '0', 'B': '8', 'S': '5', 'Z': '2', 'I': '1', 'L': '1', 'T': '1', 'A': '4', 'G': '6'}
        cand = [letter_to_digit.get(c, c) for c in field_chars]
        cand_str = "".join(cand)
        if cand_str.isdigit() and calculate_icao_check_digit(cand_str) == expected_digit:
            return cand_str, True

    # Try single-character substitution (prioritize non-digit positions)
    indices = sorted(range(len(field_chars)), key=lambda idx: 0 if not field_chars[idx].isdigit() else 1)
    for idx in indices:
        ch = field_chars[idx]
        alternatives = CONFUSION_MAP.get(ch, [])
        for alt in alternatives:
            candidate_chars = list(field_chars)
            candidate_chars[idx] = alt
            cand_str = "".join(candidate_chars)
            # Never mutate pos 0 or 1 into digits for 9-char doc numbers
            if len(cand_str) == 9 and (cand_str[0].isdigit() or cand_str[1].isdigit() or not cand_str[2:].isdigit()):
                continue
            if len(cand_str) == 6 and not cand_str.isdigit():
                continue
            if calculate_icao_check_digit(cand_str) == expected_digit:
                return cand_str, True

    # Try two-character substitutions if single-char didn't find a match
    pairs = []
    for i in range(len(field_chars)):
        for j in range(i + 1, len(field_chars)):
            pairs.append((i, j))
    pairs.sort(key=lambda p: (0 if not field_chars[p[0]].isdigit() else 1) + (0 if not field_chars[p[1]].isdigit() else 1))

    for i, j in pairs:
        alts_i = CONFUSION_MAP.get(field_chars[i], [])
        for alt_i in alts_i:
            alts_j = CONFUSION_MAP.get(field_chars[j], [])
            for alt_j in alts_j:
                cand_chars = list(field_chars)
                cand_chars[i] = alt_i
                cand_chars[j] = alt_j
                cand_str = "".join(cand_chars)
                if len(cand_str) == 9 and (cand_str[0].isdigit() or cand_str[1].isdigit() or not cand_str[2:].isdigit()):
                    continue
                if len(cand_str) == 6 and not cand_str.isdigit():
                    continue
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
            if (l1.startswith(('I', '1', 'A', 'C', 'IT', 'IU')) or 'UZB' in l1[:10]) and len(l1) >= 20:
                td1_lines = (l1, l2, l3)
                break

        if td1_lines:
            l1, l2, l3 = td1_lines
            # Pad to 30 chars if slight crop
            l1 = l1.ljust(30, '<')
            l2 = l2.ljust(30, '<')
            l3 = l3.ljust(30, '<')

            # 1. Document Number Checksum (Line 1)
            raw_doc = None
            doc_cd = None

            # Priority 1: Match from mrz_data if already extracted accurately
            extracted_doc = mrz_data.get('document_number') if mrz_data else None
            if extracted_doc and len(extracted_doc) == 9:
                norm_ext = normalize_mrz_doc_chars(extracted_doc)
                idx_in_l1 = l1.find(extracted_doc)
                if idx_in_l1 == -1:
                    idx_in_l1 = l1.find(norm_ext)
                if idx_in_l1 != -1 and len(l1) > idx_in_l1 + 9 and l1[idx_in_l1 + 9].isdigit():
                    raw_doc = norm_ext
                    doc_cd = l1[idx_in_l1 + 9]

            # Priority 2: Anchor relative to 14-digit JSHSHIR at right side of line 1
            if not raw_doc:
                m_jsh = re.search(r'([3-6]\d{13})<?$', l1)
                if m_jsh and m_jsh.start() >= 10:
                    doc_chunk = l1[m_jsh.start() - 10 : m_jsh.start()]
                    cand_doc = normalize_mrz_doc_chars(doc_chunk[:9])
                    cand_cd = doc_chunk[9]
                    if len(cand_doc) == 9 and cand_doc[:2].isalpha() and cand_doc[2:].isdigit():
                        raw_doc = cand_doc
                        if cand_cd.isdigit():
                            doc_cd = cand_cd

            # Priority 3: Regex search for 2 letters/lookalikes + 7 digits
            if not raw_doc:
                m_doc = re.search(r'([A-Z0-9]{2}\d{7})([0-9])?', l1)
                if m_doc:
                    cand_doc = normalize_mrz_doc_chars(m_doc.group(1))
                    if len(cand_doc) == 9 and cand_doc[:2].isalpha() and cand_doc[2:].isdigit():
                        raw_doc = cand_doc
                        doc_cd = m_doc.group(2)

            # Priority 4: Positional fallback
            if not raw_doc:
                idx_uzb = l1.find('UZB')
                if idx_uzb != -1 and len(l1) >= idx_uzb + 13:
                    raw_doc = normalize_mrz_doc_chars(l1[idx_uzb + 3 : idx_uzb + 12])
                    doc_cd = l1[idx_uzb + 12] if l1[idx_uzb + 12].isdigit() else None
                else:
                    raw_doc = normalize_mrz_doc_chars(l1[5:14])
                    doc_cd = l1[14] if len(l1) > 14 and l1[14].isdigit() else None

            if raw_doc and doc_cd:
                corrected_doc, was_corr = auto_correct_mrz_field(raw_doc, doc_cd)
                if was_corr:
                    result['auto_corrections_applied'].append(f"DocNum '{raw_doc}' -> '{corrected_doc}'")
                    raw_doc = corrected_doc
                result['document_number_valid'] = verify_icao_check_digit(raw_doc, doc_cd)
                result['details']['doc_check'] = {'data': raw_doc, 'check_digit': doc_cd, 'valid': result['document_number_valid']}

            # 2. Birth Date & Expiry Date Checksums (Line 2)
            l2_norm = l2.replace('М', 'M').replace('Ж', 'F')
            def _clean_date_digits(s: str) -> str:
                dmap = {'O': '0', 'D': '0', 'Q': '0', 'o': '0', 'I': '1', 'L': '1', 'l': '1', '|': '1', 'T': '1',
                        'Z': '2', 'z': '2', 'A': '4', 'S': '5', 's': '5', 'G': '6', 'b': '6', 'B': '8'}
                return ''.join(dmap.get(c, c) for c in s)

            raw_birth = None
            birth_cd = None
            raw_expiry = None
            expiry_cd = None

            m_l2 = re.search(r'([A-Z0-9]{6})([0-9])[MF<]([A-Z0-9]{6})([0-9])', l2_norm)
            if m_l2:
                raw_birth = _clean_date_digits(m_l2.group(1))
                birth_cd = m_l2.group(2)
                raw_expiry = _clean_date_digits(m_l2.group(3))
                expiry_cd = m_l2.group(4)
            else:
                sex_idx = -1
                for s_idx in range(5, min(12, len(l2_norm))):
                    if l2_norm[s_idx] in ('M', 'F'):
                        sex_idx = s_idx
                        break
                if sex_idx >= 6:
                    raw_b_chunk = _clean_date_digits(l2_norm[:sex_idx])
                    if len(raw_b_chunk) >= 7:
                        raw_birth = raw_b_chunk[-7:-1]
                        birth_cd = raw_b_chunk[-1] if raw_b_chunk[-1].isdigit() else None
                    else:
                        raw_birth = raw_b_chunk[:6]
                        birth_cd = raw_b_chunk[6] if len(raw_b_chunk) > 6 and raw_b_chunk[6].isdigit() else None

                    after_s = _clean_date_digits(l2_norm[sex_idx + 1 :])
                    if len(after_s) >= 7:
                        raw_expiry = after_s[:6]
                        expiry_cd = after_s[6] if after_s[6].isdigit() else None
                else:
                    raw_birth = _clean_date_digits(l2_norm[0:6])
                    birth_cd = l2_norm[6] if len(l2_norm) > 6 and l2_norm[6].isdigit() else None
                    raw_expiry = _clean_date_digits(l2_norm[8:14])
                    expiry_cd = l2_norm[14] if len(l2_norm) > 14 and l2_norm[14].isdigit() else None

            if raw_birth and birth_cd:
                corrected_birth, was_corr = auto_correct_mrz_field(raw_birth, birth_cd)
                if was_corr:
                    result['auto_corrections_applied'].append(f"BirthDate '{raw_birth}' -> '{corrected_birth}'")
                    raw_birth = corrected_birth
                result['birth_date_valid'] = verify_icao_check_digit(raw_birth, birth_cd)
                result['details']['birth_check'] = {'data': raw_birth, 'check_digit': birth_cd, 'valid': result['birth_date_valid']}

            if raw_expiry and expiry_cd:
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
                # Check for single-digit optical OCR confusion (e.g. 04 vs 06, 24 vs 21/22/27)
                bd_digits = clean_bd.replace('-', '')
                pinfl_digits = pinfl_birth_date.replace('-', '')
                is_optical_discrepancy = False
                if len(bd_digits) == 8 and len(pinfl_digits) == 8 and bd_digits[:4] == pinfl_digits[:4]:
                    # Same year
                    if bd_digits[6:] == pinfl_digits[6:]:
                        # Day matches, month has optical confusion (e.g. 04 vs 06)
                        m1, m2 = bd_digits[4:6], pinfl_digits[4:6]
                        if (m1 in ['04', '06', '01', '07'] and m2 in ['04', '06', '01', '07']):
                            is_optical_discrepancy = True
                    elif bd_digits[4:6] == pinfl_digits[4:6]:
                        # Month matches, day has optical confusion
                        d1, d2 = bd_digits[6:], pinfl_digits[6:]
                        if sum(1 for a, b in zip(d1, d2) if a != b) <= 1:
                            is_optical_discrepancy = True
                    elif sum(1 for a, b in zip(bd_digits, pinfl_digits) if a != b) <= 1:
                        is_optical_discrepancy = True

                if is_optical_discrepancy:
                    res['birth_date_matches'] = True
                    res['optical_reconciliation'] = {
                        'ocr_date': clean_bd,
                        'authoritative_date': pinfl_birth_date,
                        'note': f"Tug'ilgan sanada optik farq aniqlandi (OCR='{clean_bd}' vs JSHSHIR='{pinfl_birth_date}'), JSHSHIR ma'lumoti qabul qilindi."
                    }
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
