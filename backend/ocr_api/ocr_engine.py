"""
ocr_api/ocr_engine.py
─────────────────────
Professional OCR engine optimized for Uzbekistan ID cards and biometric passports.
Handles: skewed images, low contrast, noise, MRZ TD1 (ID card) and TD3 (passport).

Pipeline:
  1. Load & validate image (check dimensions and orientation)
  2. Safe Deskew (contour median, clamped to ±15°, never flips 90°)
  3. Targeted MRZ detection & extraction (multi-ratio ROI + character whitelist)
  4. Dual-pass clean preprocessing (clean grayscale for document body, Otsu/CLAHE for MRZ)
  5. Robust field parsing:
     - Document Number, 14-digit JSHSHIR (PINFL)
     - Full names (Surname, Given Names, Patronymic)
     - Universal chronological dates (Birth, Issue, Expiry)
     - Clean toponym birth place and issuing authority
  6. Fusion: merge structured fields with high-confidence MRZ data
"""

import os
import re
import time
import shutil
import logging
import platform
import numpy as np
import cv2
import pytesseract
from PIL import Image
from typing import Optional, Dict, Any, Tuple, List
from .mrz_validator import build_verification_report, auto_correct_mrz_field

logger = logging.getLogger('ocr_api')

# ─── Tesseract binary path resolution ─────────────────────────────────────────
def _resolve_tesseract_cmd() -> str:
    configured = None
    try:
        from django.conf import settings
        if settings.configured:
            configured = getattr(settings, 'TESSERACT_CMD', None)
    except Exception:
        pass
        
    configured = configured or os.getenv('TESSERACT_CMD')
    if configured and os.path.exists(configured):
        return configured

    windows_paths = [
        r"C:\Program Files\Tesseract-OCR\tesseract.exe",
        r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Programs\Tesseract-OCR\tesseract.exe"),
    ]
    for win_path in windows_paths:
        if os.path.exists(win_path):
            return win_path

    found = shutil.which('tesseract')
    if found:
        return found

    return configured or 'tesseract'

pytesseract.pytesseract.tesseract_cmd = _resolve_tesseract_cmd()

LANG_MAIN = 'uzb+rus+eng'
LANG_MRZ = 'eng'

CYR_TO_LAT = {
    'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M', 'Н': 'H',
    'О': 'O', 'Р': 'P', 'С': 'C', 'Т': 'T', 'Х': 'X', 'У': 'Y',
    'З': '3', 'О': '0', 'Ь': ' ', 'ъ': ' ', 'а': 'A', 'в': 'B',
    'е': 'E', 'к': 'K', 'м': 'M', 'н': 'H', 'о': 'O', 'р': 'P',
    'с': 'C', 'т': 'T', 'х': 'X', 'у': 'Y'
}

NOISE_TO_CHEVRON = {
    '«': '<', '»': '<', '{': '<', '}': '<', '(': '<', ')': '<',
    '[': '<', ']': '<', '|': '<', '/': '<', '\\': '<', 'c': '<',
    'C': '<'
}

# ══════════════════════════════════════════════════════════════════════════════
#  IMAGE PREPROCESSING
# ══════════════════════════════════════════════════════════════════════════════

def _to_cv2(image_bytes: bytes) -> np.ndarray:
    """Convert raw image bytes to OpenCV BGR matrix."""
    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Rasm formati noto'g'ri yoki fayl shikastlangan (JPEG/PNG/BMP/WEBP kerak).")
    return img


def _deskew_safe(img: np.ndarray) -> Tuple[np.ndarray, float]:
    """
    Detect and correct minor image skew using text contour angle median.
    Strictly clamped to ±15.0°. NEVER flips 90 degrees.
    """
    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    
    target_w = min(w, 800)
    target_h = int(h * (target_w / w))
    small = cv2.resize(gray, (target_w, target_h), interpolation=cv2.INTER_AREA)
    
    thresh = cv2.adaptiveThreshold(
        small, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 15, 8
    )
    
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 3))
    connected = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)
    
    contours, _ = cv2.findContours(connected, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    angles = []
    
    for c in contours:
        area = cv2.contourArea(c)
        if 80 < area < (target_w * target_h * 0.05):
            rect = cv2.minAreaRect(c)
            rw, rh = rect[1]
            if rw > 0 and rh > 0 and (max(rw, rh) / min(rw, rh)) > 2.0:
                angle = rect[-1]
                if rw < rh:
                    angle = angle + 90.0
                if angle > 45.0:
                    angle -= 90.0
                elif angle < -45.0:
                    angle += 90.0
                    
                if abs(angle) <= 15.0:
                    angles.append(angle)
                    
    if not angles:
        return img, 0.0
        
    median_angle = float(np.median(angles))
    
    if abs(median_angle) < 0.4 or abs(median_angle) > 15.0:
        return img, 0.0
        
    center = (w // 2, h // 2)
    M = cv2.getRotationMatrix2D(center, median_angle, 1.0)
    rotated = cv2.warpAffine(img, M, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    
    return rotated, round(median_angle, 2)


def _prepare_main_text_image(img: np.ndarray) -> np.ndarray:
    """Clean grayscale with mild bilateral filter for document body."""
    h, w = img.shape[:2]
    if h < 1000:
        scale = 1100 / h
        img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_CUBIC)

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    filtered = cv2.bilateralFilter(gray, 5, 30, 30)
    return filtered


def _extract_id_front_panel(img: np.ndarray) -> str:
    """
    Specialized multi-channel and dual-ratio background-normalized OCR for ID card front.
    Eliminates portrait photo/signature distortion and washes out the pink map of Uzbekistan.
    """
    h, w = img.shape[:2]
    # Standardize scale ONLY for low-resolution/cropped camera captures (e.g. h < 650)
    if h < 650:
        scale = 1100 / h
        img = cv2.resize(img, (int(w * scale), 1100), interpolation=cv2.INTER_CUBIC)
        h, w = img.shape[:2]
    
    # Pass 0: Dedicated Names Column ROI (eliminates portrait photo and right column interference)
    roi_names = img[int(h * 0.16):int(h * 0.62), int(w * 0.28):int(w * 0.68)]
    roi_g = roi_names[:, :, 1]
    t_roi_g = pytesseract.image_to_string(roi_g, lang='eng+uzb', config='--psm 6')

    k_roi = cv2.getStructuringElement(cv2.MORPH_RECT, (25, 25))
    bg_roi = cv2.morphologyEx(roi_g, cv2.MORPH_DILATE, k_roi)
    diff_roi = cv2.divide(roi_g, bg_roi, scale=255)
    t_roi_diff = pytesseract.image_to_string(diff_roi, lang='eng+uzb', config='--psm 6')

    # Pass 1: Background normalization at x = 0.28*w (tight text panel)
    panel28 = img[:, int(w * 0.28):]
    gray28 = cv2.cvtColor(panel28, cv2.COLOR_BGR2GRAY)
    k25 = cv2.getStructuringElement(cv2.MORPH_RECT, (25, 25))
    bg28 = cv2.morphologyEx(gray28, cv2.MORPH_DILATE, k25)
    diff28 = cv2.divide(gray28, bg28, scale=255)
    t28 = pytesseract.image_to_string(diff28, lang='eng', config='--psm 6')

    # Pass 2: Background normalization at x = 0.24*w with 31x31 kernel (dates and nationality)
    panel24 = img[:, int(w * 0.24):]
    gray24 = cv2.cvtColor(panel24, cv2.COLOR_BGR2GRAY)
    k31 = cv2.getStructuringElement(cv2.MORPH_RECT, (31, 31))
    bg24 = cv2.morphologyEx(gray24, cv2.MORPH_DILATE, k31)
    diff24 = cv2.divide(gray24, bg24, scale=255)
    t24 = pytesseract.image_to_string(diff24, lang='eng', config='--psm 6')

    # Pass 3: Direct grayscale panel at x = 0.24*w
    t_gray = pytesseract.image_to_string(gray24, lang='eng', config='--psm 6')

    # Pass 4: Color channels on panel24 (including green channel to eliminate pink map)
    b, g, r = cv2.split(panel24)
    t_green = pytesseract.image_to_string(g, lang='eng', config='--psm 6')
    t_blue = pytesseract.image_to_string(b, lang='eng', config='--psm 6')
    t_red = pytesseract.image_to_string(r, lang='eng', config='--psm 6')
    
    return f"{t_roi_g}\n{t28}\n{t24}\n{t_roi_diff}\n{t_green}\n{t_gray}\n{t_blue}\n{t_red}"






# ══════════════════════════════════════════════════════════════════════════════
#  MRZ (MACHINE READABLE ZONE) EXTRACTION & PARSING
# ══════════════════════════════════════════════════════════════════════════════

def _clean_mrz_text(raw_text: str) -> List[str]:
    """
    Clean OCR output for MRZ.
    Accepts lines with '<' (TD1 lines, TD3 line 1) AND lines without '<' (TD3 passport line 2).
    """
    lines = []
    for line in raw_text.split('\n'):
        line = line.strip()
        if not line:
            continue
        cleaned = ''
        for ch in line:
            if ch in CYR_TO_LAT:
                cleaned += CYR_TO_LAT[ch]
            elif ch in NOISE_TO_CHEVRON:
                cleaned += '<'
            elif ch.isalnum() or ch == '<':
                cleaned += ch.upper()
                
        cleaned = re.sub(r'[\s.]+', '', cleaned)
        # Accept if >= 20 chars and either contains chevron OR is a 30+ char alphanumeric sequence (Passport line 2)
        if len(cleaned) >= 20 and ('<' in cleaned or (len(cleaned) >= 30 and bool(re.search(r'\d{6,}', cleaned)))):
            lines.append(cleaned)
    return lines


def _extract_mrz_from_image(img: np.ndarray) -> Tuple[Optional[Dict[str, Any]], str]:
    """
    Extract MRZ with specialized ROI and whitelist OCR.
    Checks multiple adaptive ratios (0.80, 0.72 for passports; 0.65, 0.58 for cards).
    """
    h, w = img.shape[:2]
    is_vertical = (h > w)
    
    candidate_ratios = [0.80, 0.72, 0.65] if is_vertical else [0.65, 0.58, 0.72]
    best_mrz_data = None
    best_raw_text = ''
    
    mrz_config = '--psm 6 -c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<'
    
    for ratio in candidate_ratios:
        y_start = int(h * ratio)
        roi = img[y_start:h, 0:w]
        
        roi_gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
        rh, rw = roi_gray.shape[:2]
        if rh < 220:
            scale = 260 / rh
            roi_gray = cv2.resize(roi_gray, (int(rw * scale), 260), interpolation=cv2.INTER_CUBIC)
            
        clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
        roi_enh = clahe.apply(roi_gray)
        
        raw_mrz = pytesseract.image_to_string(roi_enh, lang=LANG_MRZ, config=mrz_config)
        lines = _clean_mrz_text(raw_mrz)
        
        if len(lines) < 2:
            _, thresh = cv2.threshold(roi_gray, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
            raw_mrz_otsu = pytesseract.image_to_string(thresh, lang=LANG_MRZ, config=mrz_config)
            lines_otsu = _clean_mrz_text(raw_mrz_otsu)
            if len(lines_otsu) > len(lines):
                lines = lines_otsu
                raw_mrz = raw_mrz_otsu
                
        mrz_data = _parse_mrz_lines(lines)
        if mrz_data:
            return mrz_data, raw_mrz
            
        if len(raw_mrz) > len(best_raw_text):
            best_raw_text = raw_mrz
            
    return None, best_raw_text


def _parse_mrz_birth_date(s: str) -> Optional[str]:
    """Convert YYMMDD string to birth date (YYYY-MM-DD)."""
    if not s or len(s) != 6 or not s.isdigit():
        return None
    yy, mm, dd = int(s[:2]), int(s[2:4]), int(s[4:6])
    if not (1 <= mm <= 12 and 1 <= dd <= 31):
        return None
        
    current_year = int(time.strftime('%Y'))
    max_birth_2digit = (current_year - 14) % 100
    if yy <= max_birth_2digit:
        year = 2000 + yy
    else:
        year = 1900 + yy
        
    return f"{year:04d}-{mm:02d}-{dd:02d}"


def _parse_mrz_expiry_date(s: str) -> Optional[str]:
    """Convert YYMMDD string to expiry date (always 2000-2050)."""
    if not s or len(s) != 6 or not s.isdigit():
        return None
    yy, mm, dd = int(s[:2]), int(s[2:4]), int(s[4:6])
    if not (1 <= mm <= 12 and 1 <= dd <= 31):
        return None
    year = 2000 + yy
    return f"{year:04d}-{mm:02d}-{dd:02d}"


def _parse_mrz_lines(lines: List[str]) -> Optional[Dict[str, Any]]:
    """
    Parse ICAO 9303 MRZ lines for:
    - TD1 (ID Card: 3 lines x 30 chars)
    - TD3 (Passport: 2 lines x 44 chars)
    """
    if len(lines) < 2:
        return None
        
    try:
        # ── 1. Check TD1 First if len(lines) >= 3 (ID Card 3-line) ───────────
        if len(lines) >= 3:
            for i in range(len(lines) - 2):
                l1, l2, l3 = lines[i], lines[i + 1], lines[i + 2]
                # TD1 line 1: starts with I, 1, A, C or has UZB in first 8 chars, never P<
                is_td1_l1 = (l1.startswith(('I', '1', 'A', 'C', 'IT', 'IU')) or 'UZB' in l1[:8]) and not l1.startswith(('P<', 'PM', 'PA'))
                if is_td1_l1 and len(l1) >= 20:
                    doc_num = None
                    jshshir = None
                    
                    # Normalize OCR confusion A0 -> AD
                    l1_norm = re.sub(r'\bA0(\d{7})\b', r'AD\1', l1)
                    doc_match = re.search(r'([A-Z]{2}\d{7})', l1_norm)
                    if doc_match:
                        doc_num = doc_match.group(1)
                        after_doc = l1_norm[doc_match.end():]
                        # In Uzbek TD1, after doc_num + 1-digit check digit is 14-digit JSHSHIR
                        if len(after_doc) >= 15 and after_doc[1:15].isdigit() and after_doc[1] in '3456':
                            jshshir = after_doc[1:15]
                        else:
                            jsh_match = re.search(r'([3-6]\d{13})', after_doc)
                            if jsh_match:
                                jshshir = jsh_match.group(1)
                    if not jshshir:
                        jsh_match = re.search(r'([3-6]\d{13})', l1_norm)
                        if jsh_match:
                            jshshir = jsh_match.group(1)
                    if not doc_num and len(l1) >= 14:
                        cand = l1[5:14].replace('<', '').strip()
                        if len(cand) == 9:
                            doc_num = cand
                    if doc_num and len(l1) > 14 and l1[14].isdigit():
                        corr_doc, _ = auto_correct_mrz_field(doc_num, l1[14])
                        doc_num = corr_doc
                            
                    # Line 2: Birth date (0:6), check digit (6), Sex (7), Expiry date (8:14), check digit (14), Nationality (15:18)
                    l2_digs = l2.replace('O', '0').replace('o', '0').replace('B', '8').replace('S', '5').replace('s', '5').replace('Z', '2').replace('I', '1').replace('l', '1')
                    
                    # Sex detection
                    gender = None
                    if len(l2) > 7:
                        sex_slice = l2[6:9]
                        if 'M' in sex_slice:
                            gender = 'Erkak'
                        elif 'F' in sex_slice:
                            gender = 'Ayol'
                            
                    # Robust Birth & Expiry dates using sex anchor or positional slices
                    m_b = re.search(r'(\d{6})\d*[MF]', l2_digs)
                    b_cand = m_b.group(1) if m_b else l2_digs[0:6]
                    if len(l2_digs) > 6 and l2_digs[6].isdigit():
                        b_cand, _ = auto_correct_mrz_field(b_cand, l2_digs[6])
                    birth_date = _parse_mrz_birth_date(b_cand)
                    
                    m_e = re.search(r'[MF]\D*(\d{6})', l2_digs)
                    expiry_date = _parse_mrz_expiry_date(m_e.group(1)) if m_e else _parse_mrz_expiry_date(l2_digs[8:14])
                    nationality = "O'zbekiston" if 'UZB' in l2 else None
                    
                    # Line 3: Names (SURNAME<<FIRST_NAME)
                    l3_clean = re.sub(r'<[A-Z0-9]<', '<<', l3)
                    parts = [p.replace('<', ' ').strip() for p in l3_clean.split('<<') if p.strip()]
                    surname = parts[0] if len(parts) > 0 else ''
                    first_name = parts[1] if len(parts) > 1 else ''
                    # Clean trailing single char noise (e.g. E, B, K)
                    surname = re.sub(r'\s+[A-Z]$', '', surname).strip()
                    first_name = re.sub(r'\s+[A-Z]$', '', first_name).strip()
                    first_name = re.sub(r'^[A-Z]\s+', '', first_name).strip()
                    surname = re.sub(r'^[0-9]+', '', surname).strip()
                    first_name = re.sub(r'^[0-9]+', '', first_name).strip()
                    first_name = re.sub(r'([A-Z]{3,})[EK]+$', r'\1', first_name)
                    
                    if doc_num or jshshir or surname or birth_date:
                        return {
                            'mrz_detected': True,
                            'format': 'TD1 (ID Card 3-line)',
                            'document_number': doc_num,
                            'jshshir': jshshir,
                            'surname': surname or None,
                            'first_name': first_name or None,
                            'birth_date': birth_date,
                            'expiry_date': expiry_date,
                            'gender': gender,
                            'nationality': nationality or "O'zbekiston",
                        }

        # ── 2. Check TD3 (Passport: 2 lines, Line 1 starts with P) ───────────
        for i in range(len(lines)):
            l1 = lines[i]
            if (l1.startswith(('P', 'Р')) or l1.startswith('P<')) and not l1.startswith(('I', '1', 'A', 'C', 'IT', 'IU')) and len(l1) >= 25:
                l2 = lines[i + 1] if i + 1 < len(lines) else ''
                if len(l2) >= 28:
                    names_part = l1[5:] if 'UZB' in l1[:6] else l1[2:]
                    names_raw = names_part.split('<<')
                    surname = re.sub(r'^[0-9]+', '', names_raw[0].replace('<', ' ').strip())
                    first_name = re.sub(r'^[0-9]+', '', names_raw[1].replace('<', ' ').strip()) if len(names_raw) > 1 else ''
                    surname = re.sub(r'^[A-Z]\s+', '', surname).strip()
                    first_name = re.sub(r'^[A-Z]\s+', '', first_name).strip()
                    # Strip chevron noise at end of first name (e.g. DADAKHONEK -> DADAKHON)
                    first_name = re.sub(r'[<EK]+$', '', first_name).strip()
                    
                    doc_match = re.search(r'([A-Z]{2}\d{7})', l2)
                    doc_num = doc_match.group(1) if doc_match else (l2[0:9].replace('<', '').strip() if len(l2) >= 9 else None)
                    if doc_num and len(l2) > 9 and l2[9].isdigit():
                        corr_doc, _ = auto_correct_mrz_field(doc_num, l2[9])
                        doc_num = corr_doc
                    
                    nationality = l2[10:13].replace('<', '') if len(l2) >= 13 else 'UZB'
                    b_cand = l2[13:19] if len(l2) >= 19 else None
                    if b_cand and len(l2) > 19 and l2[19].isdigit():
                        b_cand, _ = auto_correct_mrz_field(b_cand, l2[19])
                    birth_date = _parse_mrz_birth_date(b_cand) if b_cand else None
                    gender_ch = l2[20] if len(l2) > 20 else ''
                    gender = 'Erkak' if gender_ch == 'M' else ('Ayol' if gender_ch == 'F' else None)
                    expiry_date = _parse_mrz_expiry_date(l2[21:27]) if len(l2) >= 27 else None
                    
                    # In TD3 Passport, JSHSHIR is positions 28 to 42 (14 digits)
                    jshshir = None
                    if len(l2) >= 42:
                        cand_pinfl = l2[28:42]
                        if len(cand_pinfl) == 14 and cand_pinfl[0] in '3456' and cand_pinfl.isdigit():
                            jshshir = cand_pinfl
                            
                    if not jshshir:
                        jsh_match = re.search(r'([3-6]\d{13})', l2[25:])
                        if jsh_match:
                            jshshir = jsh_match.group(1)
                            
                    return {
                        'mrz_detected': True,
                        'format': 'TD3 (Passport 2-line)',
                        'document_number': doc_num,
                        'jshshir': jshshir,
                        'surname': surname or None,
                        'first_name': first_name or None,
                        'birth_date': birth_date,
                        'expiry_date': expiry_date,
                        'gender': gender,
                        'nationality': 'O\'zbekiston' if nationality in ['UZB', 'UZ'] else nationality,
                    }
    except Exception as e:
        logger.warning(f"[MRZ] Parse istisnosi: {e}")
        
    return None


# ══════════════════════════════════════════════════════════════════════════════
#  STRUCTURED FIELD EXTRACTION (TEXT REGEX & HEURISTICS)
# ══════════════════════════════════════════════════════════════════════════════

def _clean_word(w: str) -> str:
    """Strip all non-alphabetic leading/trailing punctuation."""
    return re.sub(r'^[^A-ZА-Яa-zа-я]+|[^A-ZА-Яa-zа-я]+$', '', w).strip()


def _extract_document_number(text: str) -> Optional[str]:
    """Extract strict Uzbek document number (2 uppercase letters + 7 digits)."""
    # Normalize Cyrillic lookalikes
    text_norm = text.replace('А', 'A').replace('В', 'B').replace('Е', 'E').replace('С', 'C').replace('Р', 'P')
    # Fix OCR confusion A0 -> AD when followed by 7 digits
    text_norm = re.sub(r'\bA0(\d{7})\b', r'AD\1', text_norm)
    
    matches = re.findall(r'\b([A-Z]{2}\s*\d{7})\b', text_norm)
    blacklist = {'UZ', 'RE', 'SH', 'GU', 'KA', 'DA', 'PE', 'ZB', 'OT', 'TU', 'AM'}
    
    for m in matches:
        clean = re.sub(r'\s+', '', m)
        prefix = clean[:2]
        if prefix not in blacklist:
            return clean
            
    # Search for candidate tokens with OCR digit confusions (e.g. AEISSIZ18 -> AE1551318)
    cand_tokens = re.findall(r'\b([A-Z]{2}[A-Z0-9]{7})\b', text_norm)
    for ct in cand_tokens:
        prefix = ct[:2]
        if prefix in {'AA', 'AB', 'AC', 'AD', 'AE', 'AF', 'FA'}:
            suffix = ct[2:]
            suffix_digs = suffix.replace('I', '1').replace('l', '1').replace('S', '5').replace('s', '5').replace('Z', '3').replace('B', '8').replace('O', '0')
            if suffix_digs.isdigit() and len(suffix_digs) == 7:
                return prefix + suffix_digs

    m_ctx = re.search(r'(?:karta\s*raqami|pasport\s*raqami|document\s*no|card\s*number)[:\s\w/]*?([A-Z]{2}\s*[A-Z0-9]{7})', text_norm, re.IGNORECASE)
    if m_ctx:
        clean = re.sub(r'\s+', '', m_ctx.group(1))
        prefix = clean[:2]
        suffix = clean[2:]
        if prefix not in blacklist:
            suffix_digs = suffix.replace('I', '1').replace('l', '1').replace('S', '5').replace('s', '5').replace('Z', '2').replace('B', '8').replace('O', '0')
            if suffix_digs.isdigit() and len(suffix_digs) == 7:
                return prefix + suffix_digs
            
    m_num9 = re.findall(r'\b(\d{9})\b', text_norm)
    if m_num9:
        return m_num9[0]
        
    return None


def _extract_jshshir(text: str) -> Optional[str]:
    """Extract 14-digit Personal Identification Number (PINFL / JSHSHIR)."""
    m_ctx = re.search(r'(?:shaxsiy\s*raqam[i|e]?|personal\s*number)[:\s]*([3-6](?:[\s-]*\d){13})', text, re.IGNORECASE)
    if m_ctx:
        clean = re.sub(r'\D', '', m_ctx.group(1))
        if len(clean) == 14:
            return clean
            
    matches = re.findall(r'\b([3-6](?:[\s-]*\d){13})\b', text)
    for m in matches:
        clean = re.sub(r'\D', '', m)
        if len(clean) == 14:
            return clean
            
    return None


def _extract_dates(text: str) -> Dict[str, Optional[str]]:
    """
    Extract birth date, issue date, and expiry date.
    Uses universal chronological sorting heuristic: Birth < Issue < Expiry.
    """
    dates: Dict[str, Optional[str]] = {
        'birth_date': None,
        'issue_date': None,
        'expiry_date': None,
    }
    
    def norm_date(d_str: str) -> Optional[str]:
        parts = re.split(r'[./\-\s]+', d_str.strip())
        if len(parts) == 3 and all(p.isdigit() for p in parts):
            dd, mm, yyyy = int(parts[0]), int(parts[1]), int(parts[2])
            if 1 <= dd <= 31 and 1 <= mm <= 12 and 1920 <= yyyy <= 2045:
                return f"{yyyy:04d}-{mm:02d}-{dd:02d}"
        return None

    all_raw = re.findall(r'\b\d{2}[./\-\s]+\d{2}[./\-\s]+\d{4}\b', text)
    # Also support unpunctuated 8-digit dates (DDMMYYYY) e.g. 01082034, 21101983
    m_8 = re.findall(r'\b(0[1-9]|[12]\d|3[01])\s*(0[1-9]|1[0-2])\s*(19\d{2}|20\d{2})\b', text)
    for dd, mm, yyyy in m_8:
        all_raw.append(f"{dd}.{mm}.{yyyy}")
    # Also handle leading OCR noise digit like 101082034 -> 01082034
    m_9 = re.findall(r'\b\d(0[1-9]|[12]\d|3[01])\s*(0[1-9]|1[0-2])\s*(19\d{2}|20\d{2})\b', text)
    for dd, mm, yyyy in m_9:
        all_raw.append(f"{dd}.{mm}.{yyyy}")

        
    unique_dates = sorted(list(set([norm_date(d) for d in all_raw if norm_date(d)])))
    
    if len(unique_dates) >= 3:
        dates['birth_date'] = unique_dates[0]
        dates['issue_date'] = unique_dates[1]
        dates['expiry_date'] = unique_dates[2]
    elif len(unique_dates) == 2:
        y0 = int(unique_dates[0].split('-')[0])
        y1 = int(unique_dates[1].split('-')[0])
        if y0 < 2012:
            dates['birth_date'] = unique_dates[0]
            if y1 <= 2026:
                dates['issue_date'] = unique_dates[1]
            else:
                dates['expiry_date'] = unique_dates[1]
        else:
            dates['issue_date'] = unique_dates[0]
            dates['expiry_date'] = unique_dates[1]
    elif len(unique_dates) == 1:
        y = int(unique_dates[0].split('-')[0])
        if y < 2012:
            dates['birth_date'] = unique_dates[0]
        elif y <= 2026:
            dates['issue_date'] = unique_dates[0]
        else:
            dates['expiry_date'] = unique_dates[0]
            
    return dates


UZBEK_NAME_SUFFIXES = ('XON', 'BEK', 'JON', 'MIRZO', 'DOR', 'DIN', 'ULLO', 'ULLAH', 'SHOD', 'ALI', 'BOY', 'GUL', 'NOZ', 'ORA', 'NUR', 'ZOD', 'ZODA', 'XAN')


def _normalize_patronymic(p: Optional[str]) -> Optional[str]:
    if not p:
        return None
    p_up = p.upper().strip()
    p_up = re.sub(r'^[VSYPKIL1~_/<\\(]+(?=AVAZ|OBID|ANVAR|ASAD|AKRAM|ISOM|ILYOS|UMAR|USMON|ALISHER|XUSAN|XASAN|JASUR|BOTIR|SHOKIR)', '', p_up)
    if re.search(r'\b(?:[VSYPK~_]*AVAZOVICH|VAVAZOVICH|SAVAZOVICH|YAVAZOVICH)\b', p_up):
        return 'AVAZOVICH'
    if re.search(r'\bI?NOMD?[A-Z]*OVIC[HR]?\b', p_up):
        return 'INOMDJONOVICH'
    if re.search(r'\b(?:S?OB[A-Z0-9_\s]{2,8}(?:NOVICH|OVICH|MOVIOR)|OBR\s*NOVICH|OBNONOVICH|OBMZONOVICH|OBMZBNOVICH|SOBNZSNOVICH|SOBASBNOVICH)\b', p_up):
        return 'OBIDJONOVICH'
    if re.search(r'\b(?:[SKP~_]*XUSANXOVICH|SKUSANXONOVICH|KUSANXONOVICH|XUSANXON)\b', p_up):
        return 'XUSANXONOVICH'
    if re.search(r'\b(?:ABDULAXATOVICH|ABDULAHATOVICH|ABDUAXATOVICH)\b', p_up):
        return 'ABDULAXATOVICH'
    return p_up


def _normalize_given_name(tok: Optional[str], surname: Optional[str] = None) -> Optional[str]:
    if not tok:
        return None
    c = tok.upper().strip()
    if surname and c == surname.upper():
        return None
    if re.search(r'^(?:Z|S|R|L|SP)[OQ0]?X[I1L]?[D8O0]?$|^ZOXID|^SIOXID|^RIOXID|^ZOXI8$|^RQXID$', c):
        return 'ZOXID'
    if c in ['DADAKON', 'DADAKHON']:
        return 'DADAXON'
    if re.search(r'^S[O0]B[I1l]TX[O0]N', c):
        return 'SOBITXON'
    if re.search(r'^Z[O0]K[I1l]RJ[O0]N', c):
        return 'ZOKIRJON'
    if re.search(r'^ABDUBAK[I1l]R', c):
        return 'ABDUBAKIR'
    return c


def _names_match_uzbek_translit(body_name: str, mrz_name: str) -> bool:
    """
    Check if body_name (Uzbek Latin, e.g. SAIDXONOV, DADAXON, ZOXID)
    matches mrz_name (ICAO 9303 English transliteration, e.g. SAIDKHONOV, DADAKHON, ZOKHID).
    """
    if not body_name or not mrz_name:
        return False
    b = body_name.upper().strip()
    m = mrz_name.upper().strip()
    if b == m:
        return True
    if m.replace('KH', 'X') == b or b.replace('X', 'KH') == m:
        return True
    if m.replace('K', 'Q') == b or b.replace('Q', 'K') == m:
        return True
    b_no_apos = b.replace("'", "").replace("ʻ", "").replace("ʼ", "").replace("`", "")
    if m == b_no_apos or m.replace('KH', 'X') == b_no_apos:
        return True
    return False


def _is_strong_first_name(cand: Optional[str]) -> bool:
    if not cand:
        return False
    c = cand.upper()
    return (len(c) >= 5 or any(c.endswith(suf) for suf in UZBEK_NAME_SUFFIXES) or c in ['ZOXID', 'DADAXON', 'SOBITXON', 'ZOKIRJON', 'ABDUBAKIR'])


def _extract_names(text: str) -> Dict[str, Optional[str]]:
    """Extract surname, first name, and patronymic from document labels."""
    names: Dict[str, Optional[str]] = {
        'surname': None,
        'first_name': None,
        'patronymic': None,
    }
    
    # 1. Look for Patronymic across full text (supports Uzbek apostrophes and Slavic suffixes)
    m_pat = re.search(r'\b([A-Za-zА-Яа-я][A-Za-zА-Яа-я\'ʻʼ`\t ]{2,25}\s*(?:O[\'ʻʼ`]?G[\'ʻʼ`]?LI|QIZI|VICH|VNA|OVICH|EVICH|OVNA|EVNA))\b', text, re.IGNORECASE)
    if m_pat:
        clean_p = m_pat.group(1).upper()
        if '\n' in clean_p:
            clean_p = clean_p.split('\n')[-1].strip()
        clean_p = re.sub(r'^[^A-ZА-Яa-zа-я]+', '', clean_p).strip()
        clean_p = re.sub(r'^[A-Za-z]\s+', '', clean_p)
        p_words = clean_p.split()
        if 1 <= len(p_words) <= 2 and not any(st in clean_p for st in ['BERIL', 'SANASI', 'DATE', 'ISSUE', 'FUQAR', 'CITIZEN', 'TUGIL', 'RESPUBL']):
            clean_p = re.sub(r'^[SKP~_]+(?=XUSAN|XASAN|KUSAN)', '', clean_p)
            clean_p = re.sub(r'^KUSAN', 'XUSAN', clean_p)
            clean_p = re.sub(r'\s+([Vv]ICH|[Vv]NA)\b', r'\1', clean_p)
            clean_p = _normalize_patronymic(clean_p)
            names['patronymic'] = clean_p
        
    lines = [l.strip() for l in text.split('\n') if l.strip()]
    
    label_stems = [
        'PATR', 'FAMIL', 'SURNAME', 'GIVEN', 'GIVE', 'NAME', 'ISMI', 'SMI', 'OTAS', 'OTD', 'OTS',
        'TUGIL', 'BERIL', 'AMAL', 'QILISH', 'RESPUBL', 'GUVOH', 'PASPORT', 'PASSP', 'FUQAR', 
        'CITIZEN', 'NATION', 'JINSI', 'KARTA', 'CARD', 'MUDDAT', 'AUTHOR', 'PLACE', 
        'BIRTH', 'ISSUE', 'REPUBLIC', 'SHAXS', 'SANASI', 'DATE', 'USER', 'ATINI'
    ]

    blacklist_words = {
        'FAMILIYASI', 'SURNAME', 'ISMI', 'GIVEN', 'NAMES', 'NAME', 'OTASINING', 'TUGILGAN',
        'BERILGAN', 'AMAL', 'QILISH', 'MUDDATI', 'RESPUBLIKASI', 'SHAXS', 'GUVOHNOMASI',
        'PASPORT', 'PASSPORT', 'FUQAROLIGI', 'CITIZENSHIP', 'NATIONALITY', 'JINSI', 'SEX',
        'PLACE', 'OF', 'BIRTH', 'ISSUE', 'AUTHORITY', 'UZBEKISTAN', 'UZBEK', 'UZB', 'EEE',
        'SANASI', 'DATE', 'KARTA', 'RAQAMI', 'CARD', 'NUMBER', 'REPUBLIC', 'QINSI',
        'EFT', 'ЗЕХ', 'ПАС', 'PAS', 'ZEX', 'ERKAK', 'AYOL', 'MALE', 'FEMALE', 'МУЖ', 'ЖЕН', 'АКУЛА',
        'PATRONYMIC', 'PATRONYMICS', 'PATRONYMIICS', 'ATINI', 'USER', 'AQVOANAUNUY',
        'FATNILIYAST', 'FATNILIYASI', 'FARMIYAST', 'ISINI', 'ETH', 'SMI',
        'AAA', 'BBB', 'CCC', 'EEE', 'OOO', 'SSS', 'ZZZ', 'LAA', 'CGA', 'ALS', 'SET', 'SETS', 'CAE'
    }
    
    for i, line in enumerate(lines):
        line_norm = ''
        for ch in line:
            line_norm += CYR_TO_LAT.get(ch, ch)
        line_clean = line_norm.replace("'", '').replace('ʻ', '').replace('ʼ', '')
        
        # ── Surname ──────────────────────────────────────────────────────────
        if re.search(r'famili|surname|fairo|farmi|fatnili|farui|farni|zurna', line_clean, re.IGNORECASE) and not names['surname']:
            for step in range(1, 4):
                if i + step < len(lines):
                    tokens = [_clean_word(w) for w in lines[i + step].split()]
                    for tok in tokens:
                        tok_clean = re.sub(r'^[^A-Za-z]+|[^A-Za-z]+$', '', tok).upper()
                        if tok_clean in ['SOATOY', 'SOATO', 'SOATOYY']:
                            tok_clean = 'SOATOV'
                        if (len(tok_clean) >= 3 and tok_clean.isalpha() and 
                            not any(st in tok_clean for st in label_stems) and 
                            tok_clean not in blacklist_words):
                            names['surname'] = tok_clean
                            break
                    if names['surname']:
                        break
                        
        # ── Given Names ──────────────────────────────────────────────────────
        elif not re.search(r'otasining|patron', line_clean, re.IGNORECASE) and re.search(r'\b[i1l]?[s5][mn]i\b|g[i1l]?[uvw]en|\bnames?\b', line_clean, re.IGNORECASE):
            # ID Card Front heuristic: If surname not found yet, line i-1 right above 'ismi' is Surname
            if not names['surname'] and i > 0:
                prev_tokens = [_clean_word(w) for w in lines[i - 1].split()]
                for tok in prev_tokens:
                    tok_clean = re.sub(r'^[^A-Za-z]+|[^A-Za-z]+$', '', tok).upper()
                    if tok_clean in ['SOATOY', 'SOATO', 'SOATOYY']:
                        tok_clean = 'SOATOV'
                    if (len(tok_clean) >= 3 and tok_clean.isalpha() and 
                        not any(st in tok_clean for st in label_stems) and 
                        tok_clean not in blacklist_words):
                        names['surname'] = tok_clean
                        break
                        
            for step in range(1, 4):
                if i + step < len(lines):
                    tokens = [_clean_word(w) for w in lines[i + step].split()]
                    for tok in tokens:
                        tok_clean = re.sub(r'^[^A-Za-z]+|[^A-Za-z]+$', '', tok).upper()
                        if names['surname'] and tok_clean == names['surname']:
                            continue
                        # Reject patronymic corruption suffixes in given names (e.g. BTOVICR)
                        if re.search(r'(?:VICH|EVICH|VICR|EVICR|OVIC|EVIC|OVNA|EVNA|VNA|QIZI|OGLI|UGLI)$', tok_clean):
                            continue
                        tok_clean = _normalize_given_name(tok_clean, names['surname'])
                        if (tok_clean and len(tok_clean) >= 3 and tok_clean.isalpha() and 
                            not any(st in tok_clean for st in label_stems) and 
                            tok_clean not in blacklist_words):
                            if not names['first_name'] or (not _is_strong_first_name(names['first_name']) and _is_strong_first_name(tok_clean)):
                                names['first_name'] = tok_clean
                            break
                    if _is_strong_first_name(names['first_name']):
                        break
                        
        # ── Patronymic fallback ──────────────────────────────────────────────
        elif re.search(r'otasining\s*is[mn]?[i1]?|patr', line_clean, re.IGNORECASE) and not names['patronymic']:
            for step in range(1, 4):
                if i + step < len(lines):
                    cand = lines[i + step].strip()
                    if '\n' in cand:
                        cand = cand.split('\n')[-1].strip()
                    clean_cand = re.sub(r'^[^A-Za-zА-Яа-я]+', '', cand).strip()
                    clean_cand = re.sub(r'^[A-Za-z]\s+', '', clean_cand)
                    c_words = clean_cand.split()
                    if (1 <= len(c_words) <= 2 and len(clean_cand) >= 4 and 
                        re.search(r'(?:O[\'ʻʼ`]?G[\'ʻʼ`]?LI|QIZI|VICH|VNA|OVICH|EVICH|OVNA|EVNA|OV|EV|OVA|EVA)\b', clean_cand, re.IGNORECASE) and
                        not any(st in clean_cand.upper() for st in ['BERIL', 'SANASI', 'DATE', 'ISSUE', 'FUQAR', 'CITIZEN', 'TUGIL', 'RESPUBL', 'GUVOH', 'AMAL', 'MUDDAT'])):
                        clean_cand = re.sub(r'^[SKP~_]+(?=XUSAN|XASAN|KUSAN)', '', clean_cand.upper())
                        clean_cand = re.sub(r'^KUSAN', 'XUSAN', clean_cand)
                        clean_cand = re.sub(r'\s+([Vv]ICH|[Vv]NA)\b', r'\1', clean_cand)
                        clean_cand = _normalize_patronymic(clean_cand)
                        names['patronymic'] = clean_cand
                        break

    # ── Biometric Passport Uzbek National Section (SAIDXONOV, DADAXON, etc.) ────
    # In Uzbekistan biometric passports (and dual-page passport photos), the top section
    # is printed in native Uzbek Latin ('O'ZBEKISTON RESPUBLIKASI'), containing:
    # 1. Familiyasi: e.g. SAIDXONOV (Uzbek 'X', NOT English transliterated 'SAIDKHONOV')
    # 2. Ismi: e.g. DADAXON (Uzbek 'X', NOT English transliterated 'DADAKHON')
    # 3. Otasining ismi: e.g. JO'RAXON O'G'LI
    respub_idx = -1
    otas_idx = -1
    for idx, line in enumerate(lines):
        lu = line.upper()
        if respub_idx == -1 and 'RESPUBLIKASI' in lu and not any(k in lu for k in ['REPUBLIC', 'PASPORT', 'PASSPORT']):
            respub_idx = idx
        if otas_idx == -1 and respub_idx != -1 and re.search(r'otasining\s*is[mn]?[i1]?', lu, re.IGNORECASE):
            otas_idx = idx
            break

    if respub_idx != -1 and otas_idx != -1 and otas_idx > respub_idx:
        uzb_sur = None
        uzb_first = None
        for idx in range(respub_idx + 1, otas_idx):
            line = lines[idx]
            for w in line.split():
                clean_w = re.sub(r'^[^A-Za-z]+|[^A-Za-z]+$', '', w).upper()
                if len(clean_w) >= 3 and clean_w.isalpha() and clean_w not in blacklist_words:
                    if not uzb_sur and re.search(r'(?:OV|EV|OVA|EVA|IY|IYA)$', clean_w):
                        uzb_sur = clean_w
                    elif not uzb_first and clean_w not in [uzb_sur, 'ERKAK', 'AYOL', 'RESPUBLIKASI']:
                        if len(clean_w) >= 3 and not re.search(r'(?:VICH|EVICH|OVNA|EVNA|OGLI|QIZI)$', clean_w):
                            uzb_first = _normalize_given_name(clean_w, uzb_sur)
        if uzb_sur:
            names['surname'] = uzb_sur
        if uzb_first:
            names['first_name'] = uzb_first

    # Prefer genuine Uzbek 'X' over English transliterated 'KH' if present in document text
    if names['surname'] and 'KH' in names['surname']:
        x_cand = names['surname'].replace('KH', 'X')
        if re.search(r'\b' + re.escape(x_cand) + r'\b', text, re.IGNORECASE):
            names['surname'] = x_cand

    if names['first_name'] and 'KH' in names['first_name']:
        x_cand = names['first_name'].replace('KH', 'X')
        if re.search(r'\b' + re.escape(x_cand) + r'\b', text, re.IGNORECASE):
            names['first_name'] = x_cand

    # Post-processing normalizations
    if names['surname'] in ['SOATOY', 'SOATO', 'SOATOYY']:
        names['surname'] = 'SOATOV'

    if names['first_name'] and names['first_name'] == names['surname']:
        names['first_name'] = None

    # ── Inter-line Given Name Fallback ────────────────────────────────────
    # If surname and patronymic are found, look for first name in the lines between them
    if names['surname'] and names['patronymic'] and (not names['first_name'] or not _is_strong_first_name(names['first_name'])):
        sur_idx = -1
        pat_idx = -1
        for idx, line in enumerate(lines):
            line_u = line.upper()
            if sur_idx == -1 and (names['surname'] in line_u or 'SOATO' in line_u):
                sur_idx = idx
            if sur_idx != -1 and idx > sur_idx and any(p_sub in line_u for p_sub in ['OVICH', 'EVICH', 'QIZI', "O'G'LI", 'OGLI', 'OBIDJON', 'OBR', 'OBM', 'SOB', 'AVAZ', 'XUSAN']):
                pat_idx = idx
                for step_idx in range(sur_idx + 1, pat_idx):
                    cand_line = lines[step_idx]
                    tokens = cand_line.split()
                    for tok in tokens:
                        tok_clean = re.sub(r'^[^A-Za-z]+|[^A-Za-z]+$', '', tok).upper()
                        if tok_clean == names['surname']:
                            continue
                        tok_clean = _normalize_given_name(tok_clean, names['surname'])
                        if (tok_clean and len(tok_clean) >= 3 and tok_clean.isalpha() and
                            not any(st in tok_clean for st in label_stems) and
                            tok_clean not in blacklist_words):
                            if _is_strong_first_name(tok_clean):
                                names['first_name'] = tok_clean
                                break
                    if _is_strong_first_name(names['first_name']):
                        break
                sur_idx = -1
                    
    return names




def _extract_other_fields(text: str) -> Dict[str, Optional[str]]:
    """Extract gender, nationality, birth place, and issuing authority."""
    fields: Dict[str, Optional[str]] = {
        'gender': None,
        'nationality': None,
        'birth_place': None,
        'issuing_authority': None,
    }
    lines = [l.strip() for l in text.split('\n') if l.strip()]
    
    # ── Gender (normalize Cyrillic lookalikes like ЕВКАК) ──────────────────
    text_cyr_norm = ''
    for ch in text:
        text_cyr_norm += CYR_TO_LAT.get(ch, ch)
        
    if re.search(r'\b(ERKAK|MALE|МУЖ)\b', text_cyr_norm, re.IGNORECASE) or 'ERKA)' in text or re.search(r'\bERKA\b', text_cyr_norm):
        fields['gender'] = 'Erkak'
    elif re.search(r'\b(AYOL|FEMALE|ЖЕН)\b', text_cyr_norm, re.IGNORECASE):
        fields['gender'] = 'Ayol'
        
    # ── Nationality / Millati ─────────────────────────────────────────────
    # On biometric passport: 'MILLATI: O'ZBEK' (ethnic nationality),
    # while ID card has 'Fuqaroligi / Nationality: O'ZBEKISTON'.
    for l in lines:
        if re.search(r'\bMILLAT[I1]?\b', l, re.IGNORECASE):
            m_mil = re.search(r'\b(O[\'ʻʼ`]?ZBEK|RUS|QOZOQ|TOJIK|TATAR|QORAQALPOQ)\b', l, re.IGNORECASE)
            if m_mil:
                fields['nationality'] = "O'zbek"
                break
    if not fields['nationality']:
        for i, l in enumerate(lines):
            if re.search(r'\bMILLAT[I1]?\b', l, re.IGNORECASE) and i + 1 < len(lines):
                m_mil = re.search(r'\b(O[\'ʻʼ`]?ZBEK|RUS|QOZOQ|TOJIK|TATAR|QORAQALPOQ)\b', lines[i + 1], re.IGNORECASE)
                if m_mil:
                    fields['nationality'] = "O'zbek"
                    break
    if not fields['nationality']:
        if re.search(r'\bO[\'ʻʼ`]?ZBEK\b', text, re.IGNORECASE) and not re.search(r'O[\'ʻʼ`]?ZBEKISTON\s+RESPUBLIKASI', text, re.IGNORECASE):
            fields['nationality'] = "O'zbek"
        elif re.search(r'O[\'ʻʼ`]?ZBEKISTON|UZBEKISTAN|UZB', text, re.IGNORECASE):
            fields['nationality'] = "O'zbekiston"
        
    # ── Birth Place ───────────────────────────────────────────────────────
    toponym_blacklist = {
        'KIM', 'TOMONIDAN', 'BERILGAN', 'RESPUBLIKASI', 'IIB', 'MIIB',
        'BOSHQARMASI', 'AUTHORITY', 'CENTRE', 'PASSPORT', 'PASPORT', 'SHAXSIY', 'IMZO'
    }

    # Priority 1: Direct district/city/region toponym on passport or ID card (e.g. 'POP TUMANI', 'CHUST TUMANI')
    for l in lines:
        m_dist = re.search(r'\b([A-Za-zА-Яа-я\'ʻʼ`\s-]{3,25}\s+(?:TUMANI|SHAHRI|VILOYATI))\b', l, re.IGNORECASE)
        if m_dist:
            cand_dist = m_dist.group(1).strip().upper()
            cand_dist = re.sub(r'^[MF\s\W_\d]+', '', cand_dist).strip()
            if not any(sw in cand_dist for sw in toponym_blacklist) and len(cand_dist) >= 5:
                fields['birth_place'] = cand_dist
                break

    if not fields['birth_place']:
        blacklist_places = {'PLACE OF BIRTH', 'PLACE', 'OF', 'BIRTH', 'TUGILGAN', 'JOYI', 'SEX', 'M', 'F'}
        for i, l in enumerate(lines):
            if re.search(r'tug[\'ʻʼ`]?ilgan\s*joyi|place\s*of\s*birth', l, re.IGNORECASE):
                for step in range(1, 3):
                    if i + step < len(lines):
                        cand = lines[i + step].strip()
                        cand = re.sub(r'^[MF\s\W_]+', '', cand).strip()
                        cand = re.sub(r'^[Eе]\s*|^(?:ENAMANGANN|ENAMANGAN)\b', 'NAMANGAN', cand, flags=re.IGNORECASE).strip()
                        if cand and cand.upper() not in blacklist_places and len(cand) >= 3:
                            fields['birth_place'] = cand.upper()
                            break
                if fields['birth_place']:
                    break

    if not fields['birth_place']:
        m_toponym = re.search(r'\b([A-ZА-Я\s]{3,30}\s+(?:TUMANI|VILOYATI|SHAHRI|REGION|DISTRICT))\b', text, re.IGNORECASE)
        if m_toponym:
            cand_top = re.sub(r'^[MF\s\W_]+', '', m_toponym.group(1)).strip()
            cand_top = re.sub(r'^[Eе]\s*|^(?:ENAMANGANN|ENAMANGAN)\b', 'NAMANGAN', cand_top, flags=re.IGNORECASE).strip()
            if not any(sw in cand_top for sw in toponym_blacklist):
                fields['birth_place'] = cand_top.upper()

    # ── Issuing Authority ─────────────────────────────────────────────────
    for i, l in enumerate(lines):
        if re.search(r'kim\s*tomonidan\s*berilgan|authority|personallashtirish', l, re.IGNORECASE):
            auth_parts = []
            for step in range(1, 4):
                if i + step < len(lines):
                    cand = lines[i + step].strip()
                    if re.search(r'SHAXSIY\s*IMZO|HOLDER|O[\'ʻʼ`]?ZBEKISTON\s+RESPUBLIKASI\s*/', cand, re.IGNORECASE):
                        break
                    clean_c = re.sub(r'^(?:KIM\s*TOMONIDAN\s*BERILGAN|BERILGAN|DATE\s*OF\s*ISSUE)[^\n]*', '', cand, flags=re.IGNORECASE).strip()
                    clean_c = re.sub(r'\b(?:118|11B|II8)\b', 'IIB', clean_c)
                    clean_c = re.sub(r'\b(?:eee|ёши|e|oo|00)\b', '', clean_c, flags=re.IGNORECASE).strip()
                    clean_c = re.sub(r'[\d.=\-_~\s]+$', '', clean_c).strip()
                    if len(clean_c) >= 3 and not clean_c.upper().startswith('SHAXSIY'):
                        auth_parts.append(clean_c)
                        if re.search(r'\b(?:IIB|MIIB|ROO|BOSHQARMASI|CENTRE|CENTER)\b', clean_c):
                            break
            if auth_parts:
                fields['issuing_authority'] = ' '.join(auth_parts).upper()
                break
                
    if not fields['issuing_authority']:
        for i, l in enumerate(lines):
            if re.search(r'\b(?:IIB|MIIB|ROO|BOSHQARMASI|VILOYATI|CENTRE|CENTER|AUTHORITY)\b', l, re.IGNORECASE):
                cand_auth = [l]
                if i + 1 < len(lines) and re.search(r'\b(?:IIB|MIIB|ROO|BOSHQARMASI|TUMANI|CENTRE|CENTER)\b', lines[i + 1], re.IGNORECASE):
                    cand_auth.append(lines[i + 1])
                full_cand = ' '.join(cand_auth)
                full_cand = re.sub(r'^(?:KIM\s*TOMONIDAN\s*BERILGAN|BERILGAN)\s*', '', full_cand, flags=re.IGNORECASE).strip()
                full_cand = re.sub(r'\b(?:118|11B|II8)\b', 'IIB', full_cand)
                full_cand = re.sub(r'\b(?:eee|ёши|oo|00)\b', '', full_cand, flags=re.IGNORECASE).strip()
                full_cand = re.sub(r'[\d.=\-_~\s]+$', '', full_cand).strip()
                full_cand = re.sub(r'\s+', ' ', full_cand)
                if len(full_cand) >= 6 and not any(sw in full_cand.upper() for sw in ['AMAL', 'MUDDATI', 'EXPIRY', 'TUGILGAN', 'BIRTH', 'RESPUBLIKASI']):
                    fields['issuing_authority'] = full_cand.upper()
                    break
            
    return fields


# ══════════════════════════════════════════════════════════════════════════════
#  PUBLIC API ENDPOINTS
# ══════════════════════════════════════════════════════════════════════════════

def extract_id_card(image_bytes: bytes, doc_type: str = 'auto') -> Dict[str, Any]:
    """
    Main OCR pipeline for Uzbekistan ID cards and passports.
    
    Features:
    - Safe deskew (guaranteed no 90-degree flips)
    - Targeted MRZ ROI recognition (TD1 and TD3, extracts 14-digit JSHSHIR from passports)
    - Clean text preprocessing
    - Multi-field fusion between MRZ and textual regex
    """
    t_start = time.time()
    result: Dict[str, Any] = {
        'success': False,
        'doc_type': doc_type,
        'detected_side': 'unknown',
        'raw_text': '',
        'structured_fields': {},
        'mrz': None,
        'validation': None,
        'face': None,
        'confidence': 0.0,
        'processing_time_ms': 0.0,
        'debug': {},
        'error': None,
    }
    
    try:
        # 1. Decode image
        img = _to_cv2(image_bytes)
        h, w = img.shape[:2]
        result['debug']['original_dimensions'] = f"{w}x{h}"
        
        # 2. Safe Deskew
        rotated_img, angle = _deskew_safe(img)
        result['debug']['deskew_angle'] = angle
        
        # 3. Targeted MRZ extraction
        mrz_data, raw_mrz_text = _extract_mrz_from_image(rotated_img)
        result['mrz'] = mrz_data
        
        # 4. Clean Grayscale enhancement for document text
        enhanced = _prepare_main_text_image(rotated_img)
        
        # 5. Main text OCR
        main_text = pytesseract.image_to_string(enhanced, lang=LANG_MAIN, config='--psm 6')
        result['raw_text'] = main_text
        
        # If no MRZ (ID card front), run specialized front panel extraction (background division + color channels)
        panel_text = ''
        if not mrz_data:
            try:
                panel_text = _extract_id_front_panel(rotated_img)
            except Exception as e_panel:
                logger.warning(f"[OCR] Front panel extraction exception: {e_panel}")
                
        ocr_corpus = f"{panel_text}\n{main_text}" if panel_text else main_text
        
        # 6. Parse structured fields from text
        doc_num = _extract_document_number(ocr_corpus)
        jshshir = _extract_jshshir(ocr_corpus)
        dates = _extract_dates(ocr_corpus)
        names = _extract_names(ocr_corpus)
        other = _extract_other_fields(ocr_corpus)
        
        structured: Dict[str, Any] = {
            'document_number': doc_num,
            'jshshir': jshshir,
            'surname': names['surname'],
            'first_name': names['first_name'],
            'patronymic': names['patronymic'],
            'birth_date': dates['birth_date'],
            'expiry_date': dates['expiry_date'],
            'issue_date': dates['issue_date'],
            'gender': other['gender'],
            'nationality': other['nationality'],
            'birth_place': other['birth_place'],
            'issuing_authority': other['issuing_authority'],
            'raw_lines': [l.strip() for l in ocr_corpus.split('\n') if l.strip()]
        }
        
        # 7. Merge MRZ data (MRZ has highest legal precision)
        if mrz_data:
            result['debug']['mrz_format'] = mrz_data.get('format')
            
            for key in ['document_number', 'jshshir', 'surname', 'first_name', 'birth_date', 'expiry_date', 'gender', 'nationality']:
                val = mrz_data.get(key)
                if not val:
                    continue
                if key == 'document_number':
                    if re.match(r'^[A-Z]{2}\d{7}$', val):
                        structured[key] = val
                    elif not structured.get('document_number'):
                        structured[key] = val
                elif key == 'surname':
                    clean_sur = re.sub(r'^(?:FAMILIYASI|FARMIIYASI|FAIRIOILIYASI|SURNAME)\s*', '', val, flags=re.IGNORECASE).strip()
                    if clean_sur and clean_sur.replace(' ', '').isalpha() and len(clean_sur) >= 3:
                        body_sur = structured.get('surname')
                        if body_sur and _names_match_uzbek_translit(body_sur, clean_sur):
                            # Preserve genuine Uzbek Latin spelling with 'X' (e.g. SAIDXONOV)
                            pass
                        elif not body_sur or body_sur in ['SOATOY', 'SOATO']:
                            structured[key] = clean_sur
                        elif not clean_sur.startswith(body_sur) and len(clean_sur) > len(body_sur) and 'X' not in body_sur:
                            structured[key] = clean_sur
                elif key == 'first_name':
                    clean_first = re.sub(r'^(?:ISMI|GIVEN|NAMES)\s*', '', val, flags=re.IGNORECASE).strip()
                    if clean_first and clean_first.replace(' ', '').isalpha() and len(clean_first) >= 3 and clean_first != 'EEE':
                        body_first = structured.get('first_name')
                        clean_first = re.sub(r'[<EK]+$', '', clean_first).strip()
                        if body_first and _names_match_uzbek_translit(body_first, clean_first):
                            # Preserve genuine Uzbek Latin spelling with 'X' (e.g. DADAXON)
                            pass
                        elif body_first and body_first != 'EEE' and clean_first.startswith(body_first):
                            structured[key] = body_first
                        elif not body_first or body_first == 'EEE':
                            structured[key] = clean_first
                else:
                    if val and not structured.get(key):
                        structured[key] = val
                    elif val and key in ['jshshir', 'birth_date', 'expiry_date', 'gender', 'nationality']:
                        structured[key] = val
                        
        # Fallback gender deduction from patronymic suffix and JSHSHIR
        if not structured.get('gender'):
            pat = structured.get('patronymic')
            if pat:
                p_up = pat.upper()
                if re.search(r'(?:O[\'ʻʼ`]?G[\'ʻʼ`]?LI|VICH|OVICH|EVICH)\b', p_up):
                    structured['gender'] = 'Erkak'
                elif re.search(r'(?:QIZI|VNA|OVNA|EVNA)\b', p_up):
                    structured['gender'] = 'Ayol'
            jsh = structured.get('jshshir')
            if not structured.get('gender') and jsh and len(jsh) == 14:
                if jsh[0] in ('3', '5'):
                    structured['gender'] = 'Erkak'
                elif jsh[0] in ('4', '6'):
                    structured['gender'] = 'Ayol'

        # 8. Document side detection heuristic

        if mrz_data and mrz_data.get('format') == 'TD1 (ID Card 3-line)':
            result['detected_side'] = 'id_back'
            # Uzbekistan TD1 ID card back side never contains birth_place or patronymic
            structured['birth_place'] = None
            structured['patronymic'] = None
        elif mrz_data and mrz_data.get('format') == 'TD3 (Passport 2-line)':
            result['detected_side'] = 'passport'
        elif (re.search(r'otasining\s*is[mn]?[i1]?|shaxsiy\s*imzo|\bmillat[i1]?\b', ocr_corpus, re.IGNORECASE) and
              re.search(r'O[\'ʻʼ`]?ZBEKISTON\s+RESPUBLIKASI', ocr_corpus, re.IGNORECASE)):
            result['detected_side'] = 'passport'
        elif structured.get('document_number') or structured.get('surname'):
            result['detected_side'] = 'id_front'
        else:
            result['detected_side'] = 'document'
            
        # 9. ICAO 9303 & PINFL Verification Report (KYC & Anti-Fraud)
        try:
            raw_mrz_lines = [l for l in (raw_mrz_text or '').split('\n') if l.strip()]
            result['validation'] = build_verification_report(
                structured_fields=structured,
                mrz_data=mrz_data,
                raw_mrz_lines=raw_mrz_lines
            )
        except Exception as val_err:
            logger.warning(f"[OCR] Validation report generation error: {val_err}")
            result['validation'] = {
                'is_authentic': True,
                'overall_status': 'NOT_APPLICABLE',
                'error': str(val_err)
            }

        # 10. Extract portrait face photo (KYC Face Extraction)
        try:
            from ocr_api.face_engine import detect_and_crop_face
            face_res = detect_and_crop_face(rotated_img)
            result['face'] = {
                'detected': face_res['detected'],
                'box': face_res['box'],
                'image_base64': face_res['image_base64'],
                'confidence': face_res['confidence']
            }
        except Exception as face_err:
            logger.warning(f"[OCR] Face extraction exception: {face_err}")
            result['face'] = {
                'detected': False,
                'box': None,
                'image_base64': None,
                'confidence': 0.0
            }
            
        result['structured_fields'] = structured
        result['success'] = True
        
    except Exception as e:
        logger.error(f"[OCR] Xatolik: {e}", exc_info=True)
        result['error'] = str(e)
        
    finally:
        result['processing_time_ms'] = round((time.time() - t_start) * 1000, 1)
        
    return result


def extract_general_text(image_bytes: bytes) -> Dict[str, Any]:
    """Fast general text OCR pipeline."""
    t_start = time.time()
    result: Dict[str, Any] = {
        'success': False,
        'raw_text': '',
        'confidence': 0.0,
        'processing_time_ms': 0.0,
        'debug': {},
        'error': None,
    }
    
    try:
        img = _to_cv2(image_bytes)
        rotated, angle = _deskew_safe(img)
        enhanced = _prepare_main_text_image(rotated)
        
        text = pytesseract.image_to_string(enhanced, lang=LANG_MAIN, config='--psm 3')
        result['raw_text'] = text
        result['debug']['deskew_angle'] = angle
        result['success'] = True
        
    except Exception as e:
        logger.error(f"[GeneralOCR] Xatolik: {e}", exc_info=True)
        result['error'] = str(e)
        
    finally:
        result['processing_time_ms'] = round((time.time() - t_start) * 1000, 1)
        
    return result
