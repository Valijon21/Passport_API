"""
ocr_api/ocr_engine.py
─────────────────────
Professional OCR engine optimized for Uzbekistan ID cards and passports.
Handles: skewed images, blur, low contrast, glare, dark/light backgrounds.

Pipeline:
  1. Load & validate image
  2. Preprocess (deskew → denoise → enhance → threshold)
  3. Tesseract OCR (multi-language: uzb + rus + eng)
  4. Post-process & structure fields
  5. Return structured result with confidence + debug info
"""

import cv2
import numpy as np
import pytesseract
import logging
import time
import re
import base64
from PIL import Image, ImageEnhance, ImageFilter
from io import BytesIO
from typing import Optional
from django.conf import settings

logger = logging.getLogger('ocr_api')

import os
import shutil

# ─── Tesseract binary path ────────────────────────────────────────────────────
def _resolve_tesseract_cmd() -> str:
    # 1. Django settings or environment variable
    configured = getattr(settings, 'TESSERACT_CMD', None) or os.getenv('TESSERACT_CMD')
    if configured and os.path.exists(configured):
        return configured

    # 2. Standard Windows installation paths
    windows_paths = [
        r"C:\Program Files\Tesseract-OCR\tesseract.exe",
        r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Programs\Tesseract-OCR\tesseract.exe"),
    ]
    for win_path in windows_paths:
        if os.path.exists(win_path):
            return win_path

    # 3. System PATH search
    found_in_path = shutil.which('tesseract')
    if found_in_path:
        return found_in_path

    return configured or 'tesseract'

pytesseract.pytesseract.tesseract_cmd = _resolve_tesseract_cmd()

# ─── Language packs (install: tesseract-ocr-uzb tesseract-ocr-rus) ────────────
LANG_ID_CARD = 'uzb+rus+eng'
LANG_GENERAL  = 'uzb+rus+eng'


# ══════════════════════════════════════════════════════════════════════════════
#  IMAGE PREPROCESSING
# ══════════════════════════════════════════════════════════════════════════════

def _to_cv2(image_bytes: bytes) -> np.ndarray:
    """Convert raw bytes → OpenCV BGR image."""
    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Rasm o'qib bo'lmadi. Format: JPEG/PNG/BMP/WEBP")
    return img


def _resize_for_ocr(img: np.ndarray, target_height: int = 1200) -> np.ndarray:
    """Scale image so height ≥ target_height (Tesseract works best on large images)."""
    h, w = img.shape[:2]
    if h < target_height:
        scale = target_height / h
        img = cv2.resize(img, (int(w * scale), int(h * scale)),
                         interpolation=cv2.INTER_CUBIC)
        logger.debug(f"Rasm kengaytirildi: {w}x{h} → {img.shape[1]}x{img.shape[0]}")
    return img


def _deskew(img: np.ndarray) -> tuple[np.ndarray, float]:
    """
    Detect and correct image skew (rotation up to ±45°).
    Returns corrected image and detected angle.
    """
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    gray = cv2.bitwise_not(gray)
    thresh = cv2.threshold(gray, 0, 255,
                           cv2.THRESH_BINARY | cv2.THRESH_OTSU)[1]

    coords = np.column_stack(np.where(thresh > 0))
    if len(coords) < 10:
        return img, 0.0

    angle = cv2.minAreaRect(coords)[-1]

    # Normalize angle
    if angle < -45:
        angle = -(90 + angle)
    else:
        angle = -angle

    if abs(angle) < 0.3:
        logger.debug(f"Qiyshiqlik kam ({angle:.2f}°), tuzatish o'tkazib yuborildi")
        return img, angle

    (h, w) = img.shape[:2]
    center = (w // 2, h // 2)
    M = cv2.getRotationMatrix2D(center, angle, 1.0)
    rotated = cv2.warpAffine(img, M, (w, h),
                              flags=cv2.INTER_CUBIC,
                              borderMode=cv2.BORDER_REPLICATE)
    logger.debug(f"Rasm {angle:.2f}° ga tuzatildi")
    return rotated, angle


def _denoise(img: np.ndarray) -> np.ndarray:
    """Remove noise while preserving edges."""
    return cv2.fastNlMeansDenoisingColored(img, None, 10, 10, 7, 21)


def _enhance_contrast(img: np.ndarray) -> np.ndarray:
    """CLAHE contrast enhancement (adaptive histogram equalization)."""
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
    cl = clahe.apply(l)
    enhanced = cv2.merge((cl, a, b))
    return cv2.cvtColor(enhanced, cv2.COLOR_LAB2BGR)


def _sharpen(img: np.ndarray) -> np.ndarray:
    """Unsharp masking for text sharpening."""
    kernel = np.array([[-1, -1, -1],
                       [-1,  9, -1],
                       [-1, -1, -1]])
    return cv2.filter2D(img, -1, kernel)


def _adaptive_threshold(gray: np.ndarray) -> np.ndarray:
    """
    Adaptive binarization — works on uneven lighting, glare, shadows.
    """
    # Method 1: Adaptive Gaussian
    adaptive = cv2.adaptiveThreshold(
        gray, 255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY, 31, 10
    )
    return adaptive


def _preprocess_full(img: np.ndarray) -> tuple[np.ndarray, dict]:
    """
    Full preprocessing pipeline. Returns processed image + debug metadata.
    """
    debug = {}
    t0 = time.time()

    img = _resize_for_ocr(img)
    debug['original_size'] = f"{img.shape[1]}x{img.shape[0]}"

    img, angle = _deskew(img)
    debug['deskew_angle'] = round(angle, 2)

    img = _denoise(img)
    img = _enhance_contrast(img)
    img = _sharpen(img)

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    debug['preprocess_ms'] = round((time.time() - t0) * 1000, 1)
    logger.debug(f"Preprocessing: {debug}")
    return gray, debug


def _img_to_base64(img: np.ndarray) -> str:
    """Convert CV2 grayscale image to base64 PNG for debug display."""
    _, buffer = cv2.imencode('.png', img)
    return 'data:image/png;base64,' + base64.b64encode(buffer).decode()


# ══════════════════════════════════════════════════════════════════════════════
#  OCR CORE
# ══════════════════════════════════════════════════════════════════════════════

def _run_tesseract(gray: np.ndarray, lang: str, psm: int = 6) -> dict:
    """
    Run Tesseract and return text + per-word confidence data.
    PSM modes:
      3 = fully automatic (general text)
      4 = single column
      6 = uniform block of text (good for ID cards)
      11 = sparse text (scattered text)
      12 = sparse + OSD
    """
    config = f'--oem 3 --psm {psm} -c preserve_interword_spaces=1'

    try:
        # Full text
        text = pytesseract.image_to_string(gray, lang=lang, config=config)

        # Word-level confidence data
        data = pytesseract.image_to_data(
            gray, lang=lang, config=config,
            output_type=pytesseract.Output.DICT
        )

        # Calculate average confidence (exclude -1 values)
        confidences = [int(c) for c in data['conf'] if int(c) > 0]
        avg_conf = round(sum(confidences) / len(confidences), 1) if confidences else 0

        return {
            'text': text.strip(),
            'confidence': avg_conf,
            'word_data': data,
        }
    except pytesseract.TesseractNotFoundError:
        logger.error("Tesseract o'rnatilmagan! sudo apt install tesseract-ocr")
        raise RuntimeError(
            "Tesseract OCR o'rnatilmagan. "
            "Buyruq: sudo apt install tesseract-ocr tesseract-ocr-uzb tesseract-ocr-rus"
        )


def _multi_psm_ocr(gray: np.ndarray, lang: str) -> dict:
    """
    Run OCR with multiple PSM modes, return best result by confidence.
    This dramatically improves accuracy on difficult images.
    """
    psm_modes = [6, 4, 3, 11]
    results = []

    for psm in psm_modes:
        try:
            result = _run_tesseract(gray, lang, psm)
            result['psm'] = psm
            results.append(result)
            logger.debug(f"PSM {psm}: conf={result['confidence']}%, chars={len(result['text'])}")
        except Exception as e:
            logger.warning(f"PSM {psm} xato: {e}")

    if not results:
        return {'text': '', 'confidence': 0, 'psm': -1}

    # Best = highest confidence AND reasonable text length
    best = max(results, key=lambda r: r['confidence'] * (1 + min(len(r['text']), 200) / 200))
    logger.info(f"Eng yaxshi PSM: {best['psm']} (conf={best['confidence']}%)")
    return best


# ══════════════════════════════════════════════════════════════════════════════
#  FIELD EXTRACTION (Uzbekistan ID / Passport patterns)
# ══════════════════════════════════════════════════════════════════════════════

UZ_MONTH_MAP = {
    'yanvar': '01', 'fevral': '02', 'mart': '03', 'aprel': '04',
    'may': '05', 'iyun': '06', 'iyul': '07', 'avgust': '08',
    'sentabr': '09', 'oktyabr': '10', 'noyabr': '11', 'dekabr': '12',
    'январь': '01', 'февраль': '02', 'март': '03', 'апрель': '04',
    'май': '05', 'июнь': '06', 'июль': '07', 'август': '08',
    'сентябрь': '09', 'октябрь': '10', 'ноябрь': '11', 'декабрь': '12',
}


def _clean_text(text: str) -> str:
    """Remove OCR artifacts, normalize whitespace."""
    # Fix common OCR mistakes for Uzbek/Russian
    replacements = {
        '0': 'O', '|': 'I', '1': 'I',  # in name context
    }
    # Normalize spaces
    text = re.sub(r'\s+', ' ', text).strip()
    return text


def _extract_id_number(text: str) -> Optional[str]:
    """Uzbekistan ID card number: AA1234567 (2 letters + 7 digits)."""
    patterns = [
        r'\b[A-Z]{2}\d{7}\b',           # Standard
        r'\b[A-ZА-Я]{2}\s*\d{7}\b',     # With space
        r'\b[A-Z0-9]{9}\b',              # When OCR confuses letters/numbers
    ]
    for p in patterns:
        m = re.search(p, text, re.IGNORECASE)
        if m:
            return m.group().replace(' ', '').upper()
    return None


def _extract_passport_number(text: str) -> Optional[str]:
    """Uzbekistan passport: AA1234567 same format as ID."""
    return _extract_id_number(text)


def _extract_jshshir(text: str) -> Optional[str]:
    """JSHSHIR (INN): 14 digits."""
    m = re.search(r'\b\d{14}\b', text)
    return m.group() if m else None


def _extract_date(text: str) -> Optional[str]:
    """Extract date in various formats → YYYY-MM-DD."""
    patterns = [
        # DD.MM.YYYY or DD/MM/YYYY
        r'\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b',
        # DD Month YYYY (Uzbek/Russian)
        r'\b(\d{1,2})\s+(' + '|'.join(UZ_MONTH_MAP.keys()) + r')\s+(\d{4})\b',
        # YYYY-MM-DD (ISO)
        r'\b(\d{4})-(\d{1,2})-(\d{1,2})\b',
    ]
    for p in patterns:
        m = re.search(p, text, re.IGNORECASE)
        if m:
            groups = m.groups()
            if len(groups) == 3:
                try:
                    if groups[1].lower() in UZ_MONTH_MAP:
                        d, mon, y = groups
                        return f"{y}-{UZ_MONTH_MAP[mon.lower()]}-{int(d):02d}"
                    elif len(groups[0]) == 4:
                        return f"{groups[0]}-{int(groups[1]):02d}-{int(groups[2]):02d}"
                    else:
                        return f"{groups[2]}-{int(groups[1]):02d}-{int(groups[0]):02d}"
                except Exception:
                    pass
    return None


def _extract_gender(text: str) -> Optional[str]:
    """Extract gender from Uzbek/Russian text."""
    text_lower = text.lower()
    male_words = ['erkak', 'мужской', 'м/', 'male', 'муж']
    female_words = ['ayol', 'женский', 'ж/', 'female', 'жен']

    for w in male_words:
        if w in text_lower:
            return 'Erkak / Мужской'
    for w in female_words:
        if w in text_lower:
            return 'Ayol / Женский'
    return None


def _extract_nationality(text: str) -> Optional[str]:
    """Extract nationality."""
    patterns = [
        r"millati[:\s]+([A-ZА-Яa-zа-я]+)",
        r"гражданство[:\s]+([A-ZА-Яa-zа-я]+)",
        r"\b(o'zbekiston|узбекистан|uzbekistan)\b",
    ]
    for p in patterns:
        m = re.search(p, text, re.IGNORECASE)
        if m:
            return m.group(1).capitalize() if m.lastindex else "O'zbekiston"
    return None


def _extract_name_components(text: str) -> dict:
    """
    Try to extract surname, name, patronymic from structured lines.
    Looks for patterns like:
      Familiyasi: KARIMOV
      Ismi: JASUR
      Otasining ismi: ALIYEVICH
    """
    fields = {}
    patterns = {
        'surname': [
            r'familiy[ae]si?[:\s]+([A-ZА-Яa-z\-]+)',
            r'фамили[яи][:\s]+([A-ZА-Яa-z\-]+)',
            r'surname[:\s]+([A-Za-z\-]+)',
        ],
        'first_name': [
            r"ismi[:\s]+([A-ZА-Яa-z\-]+)",
            r"имя[:\s]+([A-ZА-Яa-z\-]+)",
            r"first\s*name[:\s]+([A-Za-z\-]+)",
        ],
        'patronymic': [
            r"otasining ismi[:\s]+([A-ZА-Яa-z\-]+)",
            r"отчество[:\s]+([A-ZА-Яa-z\-]+)",
        ],
    }
    for field, pats in patterns.items():
        for p in pats:
            m = re.search(p, text, re.IGNORECASE)
            if m:
                fields[field] = m.group(1).strip().upper()
                break
    return fields


def _structure_id_fields(raw_text: str, doc_type: str) -> dict:
    """
    Parse all key fields from raw OCR text.
    Returns structured dict with None for missing fields.
    """
    lines = [l.strip() for l in raw_text.split('\n') if l.strip()]
    full_text = ' '.join(lines)

    fields = {
        'document_number': None,
        'jshshir': None,
        'surname': None,
        'first_name': None,
        'patronymic': None,
        'birth_date': None,
        'expiry_date': None,
        'issue_date': None,
        'gender': None,
        'nationality': None,
        'birth_place': None,
        'issuing_authority': None,
        'raw_lines': lines,
    }

    # Document number
    fields['document_number'] = _extract_id_number(full_text)

    # JSHSHIR
    fields['jshshir'] = _extract_jshshir(full_text)

    # Dates - try to find multiple
    dates = []
    remaining = full_text
    for _ in range(5):
        d = _extract_date(remaining)
        if d:
            dates.append(d)
            # Remove found date to find next
            remaining = remaining[remaining.find(d[:4]) + 10:]
        else:
            break

    if dates:
        # Heuristic: birth date usually < issue date < expiry date
        dates_sorted = sorted(set(dates))
        if len(dates_sorted) >= 3:
            fields['birth_date'] = dates_sorted[0]
            fields['issue_date'] = dates_sorted[1]
            fields['expiry_date'] = dates_sorted[2]
        elif len(dates_sorted) == 2:
            fields['birth_date'] = dates_sorted[0]
            fields['expiry_date'] = dates_sorted[1]
        elif len(dates_sorted) == 1:
            fields['birth_date'] = dates_sorted[0]

    # Gender
    fields['gender'] = _extract_gender(full_text)

    # Nationality
    fields['nationality'] = _extract_nationality(full_text)

    # Name components
    name_fields = _extract_name_components(full_text)
    fields.update(name_fields)

    # Issuing authority (after "berilgan" or "выдан")
    auth_m = re.search(r'(berilgan|выдан)[:\s]+([^\n]{5,50})', full_text, re.IGNORECASE)
    if auth_m:
        fields['issuing_authority'] = auth_m.group(2).strip()

    # Birth place
    place_m = re.search(r"(tug['`ʼ]?ilgan joy|место рождения)[:\s]+([^\n]{3,60})", full_text, re.IGNORECASE)
    if place_m:
        fields['birth_place'] = place_m.group(2).strip()

    return fields


# ══════════════════════════════════════════════════════════════════════════════
#  MRZ (Machine Readable Zone) PARSER
# ══════════════════════════════════════════════════════════════════════════════

def _parse_mrz(text: str) -> Optional[dict]:
    """
    Parse ICAO 9303 MRZ from OCR output.
    Supports TD1 (ID card, 3 lines × 30 chars) and TD3 (passport, 2 lines × 44 chars).
    """
    lines = [re.sub(r'\s', '', l) for l in text.split('\n')]
    lines = [l for l in lines if len(l) >= 28 and re.match(r'^[A-Z0-9<]+$', l)]

    if len(lines) < 2:
        return None

    logger.debug(f"MRZ qatorlari topildi: {len(lines)}")

    try:
        # TD3 (passport): 2 lines × 44
        if len(lines) >= 2 and len(lines[0]) >= 44:
            l1, l2 = lines[0][:44], lines[1][:44]
            doc_type = l1[0]
            country = l1[2:5].replace('<', '')
            names_raw = l1[5:44].split('<<')
            surname = names_raw[0].replace('<', ' ').strip()
            given = names_raw[1].replace('<', ' ').strip() if len(names_raw) > 1 else ''
            doc_number = l2[0:9].replace('<', '')
            nationality = l2[10:13].replace('<', '')
            birth_raw = l2[13:19]
            birth_date = _parse_mrz_date(birth_raw)
            gender = 'Erkak' if l2[20] == 'M' else ('Ayol' if l2[20] == 'F' else None)
            expiry_raw = l2[21:27]
            expiry_date = _parse_mrz_date(expiry_raw)

            return {
                'mrz_detected': True,
                'doc_type': f'Passport ({doc_type})',
                'country': country,
                'surname': surname,
                'first_name': given,
                'document_number': doc_number,
                'nationality': nationality,
                'birth_date': birth_date,
                'gender': gender,
                'expiry_date': expiry_date,
            }

        # TD1 (ID card): 3 lines × 30
        if len(lines) >= 3 and len(lines[0]) >= 30:
            l1, l2, l3 = lines[0][:30], lines[1][:30], lines[2][:30]
            doc_number = l1[5:14].replace('<', '')
            birth_raw = l2[0:6]
            birth_date = _parse_mrz_date(birth_raw)
            gender = 'Erkak' if l2[7] == 'M' else ('Ayol' if l2[7] == 'F' else None)
            expiry_raw = l2[8:14]
            expiry_date = _parse_mrz_date(expiry_raw)
            nationality = l2[15:18].replace('<', '')
            names_raw = l3.split('<<')
            surname = names_raw[0].replace('<', ' ').strip()
            given = names_raw[1].replace('<', ' ').strip() if len(names_raw) > 1 else ''

            return {
                'mrz_detected': True,
                'doc_type': 'ID Karta (TD1)',
                'surname': surname,
                'first_name': given,
                'document_number': doc_number,
                'nationality': nationality,
                'birth_date': birth_date,
                'gender': gender,
                'expiry_date': expiry_date,
            }
    except Exception as e:
        logger.warning(f"MRZ parse xatosi: {e}")

    return None


def _parse_mrz_date(s: str) -> Optional[str]:
    """Convert YYMMDD → YYYY-MM-DD."""
    if len(s) != 6 or not s.isdigit():
        return None
    yy, mm, dd = s[:2], s[2:4], s[4:6]
    year = int(yy)
    # Assume 00-30 = 2000s, 31-99 = 1900s
    full_year = 2000 + year if year <= 30 else 1900 + year
    return f"{full_year}-{mm}-{dd}"


# ══════════════════════════════════════════════════════════════════════════════
#  MAIN PUBLIC FUNCTIONS
# ══════════════════════════════════════════════════════════════════════════════

def extract_id_card(image_bytes: bytes, doc_type: str = 'id_card') -> dict:
    """
    Main function: extract all data from Uzbekistan ID card or passport image.

    Args:
        image_bytes: Raw image file bytes
        doc_type: 'id_card' | 'passport' | 'auto'

    Returns:
        {
            success: bool,
            doc_type: str,
            raw_text: str,
            structured_fields: dict,
            mrz: dict | None,
            confidence: float,
            processing_time_ms: float,
            debug: dict,
            error: str | None,
        }
    """
    t_start = time.time()
    result = {
        'success': False,
        'doc_type': doc_type,
        'raw_text': '',
        'structured_fields': {},
        'mrz': None,
        'confidence': 0.0,
        'processing_time_ms': 0,
        'debug': {},
        'error': None,
    }

    try:
        logger.info(f"=== OCR boshlanди: doc_type={doc_type}, size={len(image_bytes)} bytes ===")

        # 1. Load
        img = _to_cv2(image_bytes)
        result['debug']['input_shape'] = f"{img.shape[1]}x{img.shape[0]}"

        # 2. Preprocess
        gray, preprocess_debug = _preprocess_full(img)
        result['debug'].update(preprocess_debug)

        # Also try adaptive threshold version
        thresh = _adaptive_threshold(gray)

        # 3. OCR — run on both preprocessed versions, pick best
        logger.info("Tesseract OCR ishga tushirilmoqda...")
        ocr1 = _multi_psm_ocr(gray, LANG_ID_CARD)
        ocr2 = _multi_psm_ocr(thresh, LANG_ID_CARD)

        # Pick better result
        if ocr1['confidence'] >= ocr2['confidence']:
            best_ocr = ocr1
            result['debug']['ocr_source'] = 'enhanced_gray'
        else:
            best_ocr = ocr2
            result['debug']['ocr_source'] = 'adaptive_threshold'

        result['debug']['psm_used'] = best_ocr.get('psm', -1)
        result['raw_text'] = best_ocr['text']
        result['confidence'] = best_ocr['confidence']

        logger.info(f"OCR natija: conf={result['confidence']}%, chars={len(result['raw_text'])}")

        # 4. MRZ detection
        mrz_data = _parse_mrz(result['raw_text'])
        if mrz_data:
            result['mrz'] = mrz_data
            logger.info("MRZ aniqlandi va parse qilindi")

        # 5. Structure fields
        structured = _structure_id_fields(result['raw_text'], doc_type)

        # Merge MRZ data (higher priority than regex)
        if mrz_data:
            for field in ['surname', 'first_name', 'document_number',
                          'birth_date', 'expiry_date', 'gender', 'nationality']:
                if mrz_data.get(field) and not structured.get(field):
                    structured[field] = mrz_data[field]

        result['structured_fields'] = structured
        result['success'] = True
        result['debug']['total_lines'] = len(structured.get('raw_lines', []))

    except Exception as e:
        logger.error(f"OCR xatosi: {e}", exc_info=True)
        result['error'] = str(e)

    finally:
        result['processing_time_ms'] = round((time.time() - t_start) * 1000, 1)
        logger.info(
            f"=== OCR tugadi: success={result['success']}, "
            f"conf={result['confidence']}%, "
            f"time={result['processing_time_ms']}ms ==="
        )

    return result


def extract_general_text(image_bytes: bytes) -> dict:
    """
    General text extraction (not ID-specific).
    Optimized for any document, receipt, sign, etc.

    Returns:
        {
            success: bool,
            raw_text: str,
            confidence: float,
            processing_time_ms: float,
            debug: dict,
            error: str | None,
        }
    """
    t_start = time.time()
    result = {
        'success': False,
        'raw_text': '',
        'confidence': 0.0,
        'processing_time_ms': 0,
        'debug': {},
        'error': None,
    }

    try:
        logger.info(f"=== Umumiy OCR boshlandи: size={len(image_bytes)} bytes ===")

        img = _to_cv2(image_bytes)
        gray, debug = _preprocess_full(img)
        result['debug'].update(debug)

        ocr = _multi_psm_ocr(gray, LANG_GENERAL)
        result['raw_text'] = ocr['text']
        result['confidence'] = ocr['confidence']
        result['debug']['psm_used'] = ocr.get('psm', -1)
        result['success'] = True

    except Exception as e:
        logger.error(f"Umumiy OCR xatosi: {e}", exc_info=True)
        result['error'] = str(e)

    finally:
        result['processing_time_ms'] = round((time.time() - t_start) * 1000, 1)
        logger.info(
            f"=== Umumiy OCR tugadi: conf={result['confidence']}%, "
            f"time={result['processing_time_ms']}ms ==="
        )

    return result
