"""
ocr_api/pdf_engine.py
──────────────────────
Multi-Page Scanned PDF Dossier OCR & Document Classification Engine.

Features:
- Accepts multi-page PDF files (banking & leasing applications, credit dossiers).
- Renders pages into high-resolution in-memory BGR images using pypdfium2 (zero external binaries).
- Automatically classifies each page (ID Front, ID Back, Passport, General Document, Blank).
- Automatically routes detected ID Front + Back sides into the Two-Sided Smart Merge pipeline
  (merge_id_card_sides) to generate a 100% unified citizen profile.
- Produces page thumbnails, OCR results per page, and a dossier-level forensic audit summary.
"""

import io
import time
import cv2
import numpy as np
import base64
import logging
from typing import Dict, Any, List, Optional, Tuple

import pypdfium2 as pdfium

from .ocr_engine import (
    extract_id_card,
    merge_id_card_sides
)
from .forensics_engine import assess_image_quality

logger = logging.getLogger('ocr_api')


def _encode_bgr_to_base64_jpeg(img_bgr: np.ndarray, quality: int = 75) -> str:
    """Encode OpenCV BGR image to base64 data URI string."""
    if img_bgr is None or img_bgr.size == 0:
        return ''
    encode_params = [int(cv2.IMWRITE_JPEG_QUALITY), quality]
    success, buffer = cv2.imencode('.jpg', img_bgr, encode_params)
    if not success:
        return ''
    b64_bytes = base64.b64encode(buffer)
    return f"data:image/jpeg;base64,{b64_bytes.decode('utf-8')}"


def _make_page_thumbnail(img_bgr: np.ndarray, max_dim: int = 320) -> str:
    """Generate small base64 thumbnail for page preview carousel."""
    h, w = img_bgr.shape[:2]
    scale = max_dim / float(max(h, w))
    if scale < 1.0:
        thumb = cv2.resize(img_bgr, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    else:
        thumb = img_bgr
    return _encode_bgr_to_base64_jpeg(thumb, quality=70)


def classify_page_type(ocr_res: Dict[str, Any]) -> str:
    """
    Classify scanned page into 'id_front', 'id_back', 'passport', or 'general_document'.
    """
    if not ocr_res or not isinstance(ocr_res, dict):
        return 'unknown'

    mrz = ocr_res.get('mrz') or {}
    sf = ocr_res.get('structured_fields') or {}
    face = ocr_res.get('face') or {}
    det_type = ocr_res.get('detected_document_type') or ocr_res.get('document_type')

    # 1. Back side check: TD1 3-line MRZ or 14-digit JSHSHIR without face
    if mrz.get('format') == 'TD1 (ID Card 3-line)' or det_type == 'id_back':
        return 'id_back'
    if sf.get('jshshir') and not face.get('detected'):
        return 'id_back'

    # 2. Passport check: TD3 2-line MRZ or passport detected
    if mrz.get('format') == 'TD3 (Passport 2-line)' or det_type == 'passport':
        return 'passport'

    # 3. Front side check: Portrait face detected + ID front markers
    if face.get('detected') and (sf.get('patronymic') or sf.get('document_number') or det_type == 'id_front'):
        return 'id_front'
    if det_type == 'id_front':
        return 'id_front'

    # 4. Fallback check based on extracted text content
    raw_text = (ocr_res.get('raw_text') or '').upper()
    if 'SHAXS GUVOHNOMASI' in raw_text or 'IDENTITY CARD' in raw_text:
        return 'id_front' if face.get('detected') else 'id_back'

    return 'general_document'


def process_dossier_pdf(
    pdf_bytes: bytes,
    dpi_scale: float = 2.0,
    max_pages: int = 10
) -> Dict[str, Any]:
    """
    Process multi-page PDF dossier:
      1. Renders pages using pypdfium2 in memory.
      2. Runs OCR and classifies each page.
      3. Automatically runs Two-Sided Smart Merge if ID Front & Back found.
      4. Compiles unified profile and dossier audit summary.
    """
    t_start = time.time()

    if not pdf_bytes:
        return {
            'success': False,
            'error': "PDF fayl bo'sh",
            'dossier_type': 'EMPTY',
            'total_pages': 0,
            'pages_processed': 0,
            'pages': [],
            'merged_profile': None
        }

    try:
        pdf_stream = io.BytesIO(pdf_bytes)
        doc = pdfium.PdfDocument(pdf_stream)
        total_pages = len(doc)
    except Exception as e:
        logger.error(f"[PDFEngine] PDF ochishda xatolik: {e}")
        return {
            'success': False,
            'error': f"PDF faylni o'qib bo'lmadi: {str(e)}",
            'dossier_type': 'INVALID_PDF',
            'total_pages': 0,
            'pages_processed': 0,
            'pages': [],
            'merged_profile': None
        }

    pages_to_process = min(total_pages, max_pages)
    page_results: List[Dict[str, Any]] = []

    front_candidate: Optional[Dict[str, Any]] = None
    back_candidate: Optional[Dict[str, Any]] = None
    passport_candidate: Optional[Dict[str, Any]] = None

    try:
        for idx in range(pages_to_process):
            try:
                page = doc[idx]
                # Render page to memory BGR array (scale 2.0 yields ~150-200 DPI)
                bmp = page.render(scale=dpi_scale)
                page_bgr = bmp.to_numpy()[:, :, :3]  # Strip alpha if present

                # Encode to JPEG bytes for OCR engine
                success, enc_buf = cv2.imencode('.jpg', page_bgr, [int(cv2.IMWRITE_JPEG_QUALITY), 92])
                if not success:
                    continue
                img_bytes = enc_buf.tobytes()

                # Run OCR extraction
                ocr_res = extract_id_card(img_bytes, doc_type='auto')
                # Assess page image quality
                quality_res = assess_image_quality(page_bgr)

                # Classify page
                detected_page_type = classify_page_type(ocr_res)
                thumb_b64 = _make_page_thumbnail(page_bgr)

                page_info = {
                    'page_number': idx + 1,
                    'detected_type': detected_page_type,
                    'confidence': ocr_res.get('confidence_score', 0.0),
                    'thumbnail_base64': thumb_b64,
                    'quality_score': quality_res.get('overall_quality_score', 0.0),
                    'is_blurry': quality_res.get('is_blurry', False),
                    'has_glare': quality_res.get('has_glare', False),
                    'ocr_result': ocr_res
                }
                page_results.append(page_info)

                # Track candidates for smart merge
                if detected_page_type == 'id_front' and front_candidate is None:
                    front_candidate = ocr_res
                elif detected_page_type == 'id_back' and back_candidate is None:
                    back_candidate = ocr_res
                elif detected_page_type == 'passport' and passport_candidate is None:
                    passport_candidate = ocr_res

            except Exception as err:
                logger.warning(f"[PDFEngine] {idx+1}-sahifani qayta ishlashda xatolik: {err}")
                page_results.append({
                    'page_number': idx + 1,
                    'detected_type': 'error',
                    'confidence': 0.0,
                    'error': str(err),
                    'thumbnail_base64': ''
                })
    finally:
        try:
            doc.close()
        except Exception:
            pass

    # ── Dossier Smart Merge & Synthesis ────────────────────────────────────────
    merged_profile: Optional[Dict[str, Any]] = None
    dossier_type: str = 'MULTI_PAGE_DOCUMENT'
    summary: str = ''

    if front_candidate is not None and back_candidate is not None:
        # Both ID card sides discovered in the PDF dossier!
        merged_profile = merge_id_card_sides(front_candidate, back_candidate)
        dossier_type = 'TWO_SIDED_ID_DOSSIER'
        summary = (
            f"PDF arizada ID kartaning ikkala tomoni muvaffaqiyatli aniqlandi "
            f"va Two-Sided Smart Merge orqali to'liq fuqaro profili hosil qilindi."
        )
    elif passport_candidate is not None:
        dossier_type = 'PASSPORT_DOSSIER'
        merged_profile = {
            'success': True,
            'document_type': 'PASSPORT',
            'status': 'PASSPORT_EXTRACTED',
            'is_authentic': True,
            'citizen_profile': passport_candidate.get('structured_fields', {}),
            'mrz': passport_candidate.get('mrz', {}),
            'validation': passport_candidate.get('mrz_validation', {}),
            'face': passport_candidate.get('face', {}),
            'confidence': passport_candidate.get('confidence_score', 0.0),
            'alerts': []
        }
        summary = "PDF arizada Biometrik pasport sahifasi aniqlandi va to'liq ma'lumotlari o'qildi."
    elif front_candidate is not None:
        dossier_type = 'ID_FRONT_ONLY'
        summary = "PDF faylda faqat ID kartaning old tomoni aniqlandi (orqa tomoni topilmadi)."
    elif back_candidate is not None:
        dossier_type = 'ID_BACK_ONLY'
        summary = "PDF faylda faqat ID kartaning orqa tomoni (MRZ) aniqlandi (old tomoni topilmadi)."
    else:
        dossier_type = 'GENERAL_DOCUMENT'
        summary = "PDF faylda shaxsni tasdiqlovchi standart O'zbekiston hujjati aniqlanmadi."

    elapsed_ms = round((time.time() - t_start) * 1000.0, 1)

    return {
        'success': True,
        'dossier_type': dossier_type,
        'total_pages': total_pages,
        'pages_processed': len(page_results),
        'summary': summary,
        'merged_profile': merged_profile,
        'pages': page_results,
        'processing_time_ms': elapsed_ms
    }
