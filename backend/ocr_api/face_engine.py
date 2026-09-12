"""
ocr_api/face_engine.py
──────────────────────
Face Extraction & 1:1 Face Matching (KYC) Engine.

Features:
- Detects face in ID card, passport, or live selfie photo using OpenCV.
- Applies proportional portrait padding (hair, chin, ears) for clean crop.
- Encodes cropped face to base64 JPEG format for direct JSON consumption.
- 1:1 Face Comparison using multi-scale normalized gradient and structural descriptors.
- Generates FinTech-compliant KYC match verdict (VERIFIED_MATCH, UNCERTAIN, MISMATCH).
"""

import cv2
import numpy as np
import base64
import os
import logging
from typing import Dict, Any, Optional, Tuple

logger = logging.getLogger('ocr_api')

# Cascades
_HAAR_DIR = cv2.data.haarcascades
_FACE_CASCADE_DEFAULT = os.path.join(_HAAR_DIR, 'haarcascade_frontalface_default.xml')
_FACE_CASCADE_ALT2 = os.path.join(_HAAR_DIR, 'haarcascade_frontalface_alt2.xml')

# Load classifiers once
_face_detector_default = cv2.CascadeClassifier(_FACE_CASCADE_DEFAULT) if os.path.exists(_FACE_CASCADE_DEFAULT) else None
_face_detector_alt2 = cv2.CascadeClassifier(_FACE_CASCADE_ALT2) if os.path.exists(_FACE_CASCADE_ALT2) else None


def _encode_bgr_to_base64_jpeg(img_bgr: np.ndarray, quality: int = 90) -> str:
    """Encode OpenCV BGR image to base64 data URI string."""
    encode_params = [int(cv2.IMWRITE_JPEG_QUALITY), quality]
    success, buffer = cv2.imencode('.jpg', img_bgr, encode_params)
    if not success:
        return ''
    b64_bytes = base64.b64encode(buffer)
    return f"data:image/jpeg;base64,{b64_bytes.decode('utf-8')}"


def detect_and_crop_face(
    image_bgr: np.ndarray,
    pad_ratio: float = 0.25,
    min_relative_size: float = 0.08
) -> Dict[str, Any]:
    """
    Detect portrait face in document or selfie and crop with natural padding.

    Args:
        image_bgr: OpenCV image (BGR).
        pad_ratio: Extra padding around bounding box (0.25 = 25% margin).
        min_relative_size: Minimum relative face size (0.08 = 8% of smaller dimension).

    Returns:
        dict:
            detected: bool
            box: {'x': int, 'y': int, 'w': int, 'h': int} or None
            image_base64: str or None
            cropped_bgr: np.ndarray or None
            confidence: float (0.0 to 1.0)
    """
    if image_bgr is None or image_bgr.size == 0:
        return {
            'detected': False,
            'box': None,
            'image_base64': None,
            'cropped_bgr': None,
            'confidence': 0.0
        }

    h, w = image_bgr.shape[:2]
    min_dim = min(h, w)
    min_size = int(min_dim * min_relative_size)

    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    # Contrast enhancement for better face detection in varied lighting
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    gray_enhanced = clahe.apply(gray)

    candidates = []

    # 1. Primary detector: alt2 (more accurate for frontal portraits)
    if _face_detector_alt2 and not _face_detector_alt2.empty():
        faces = _face_detector_alt2.detectMultiScale(
            gray_enhanced,
            scaleFactor=1.1,
            minNeighbors=5,
            minSize=(min_size, min_size)
        )
        for (x, y, fw, fh) in faces:
            candidates.append((x, y, fw, fh, 0.90))

    # 2. Secondary fallback detector: default
    if not candidates and _face_detector_default and not _face_detector_default.empty():
        faces = _face_detector_default.detectMultiScale(
            gray_enhanced,
            scaleFactor=1.1,
            minNeighbors=4,
            minSize=(min_size, min_size)
        )
        for (x, y, fw, fh) in faces:
            candidates.append((x, y, fw, fh, 0.80))

    if not candidates:
        return {
            'detected': False,
            'box': None,
            'image_base64': None,
            'cropped_bgr': None,
            'confidence': 0.0
        }

    # Rank candidates:
    # 1) Prefer portrait orientation (aspect ratio height / width between 1.0 and 1.5)
    # 2) On ID card documents, the main portrait photo is typically larger than small logos/stamps
    def score_candidate(cand):
        x, y, fw, fh, base_conf = cand
        area = fw * fh
        aspect = fh / float(fw) if fw > 0 else 0
        aspect_score = 1.0 - min(abs(aspect - 1.25), 1.0)
        # Position bonus for left half (standard ID card photo position)
        center_x = x + fw / 2.0
        pos_bonus = 1.2 if center_x < w * 0.55 else 1.0
        return area * aspect_score * pos_bonus

    best = max(candidates, key=score_candidate)
    x, y, fw, fh, conf = best

    # Apply padding around face for clean portrait photo
    pad_w = int(fw * pad_ratio)
    pad_h = int(fh * (pad_ratio + 0.05))  # slightly more padding on top for hair

    crop_x1 = max(0, x - pad_w)
    crop_y1 = max(0, y - pad_h)
    crop_x2 = min(w, x + fw + pad_w)
    crop_y2 = min(h, y + fh + pad_h)

    face_crop = image_bgr[crop_y1:crop_y2, crop_x1:crop_x2]
    if face_crop.size == 0:
        return {
            'detected': False,
            'box': None,
            'image_base64': None,
            'cropped_bgr': None,
            'confidence': 0.0
        }

    b64_str = _encode_bgr_to_base64_jpeg(face_crop)

    return {
        'detected': True,
        'box': {'x': int(crop_x1), 'y': int(crop_y1), 'w': int(crop_x2 - crop_x1), 'h': int(crop_y2 - crop_y1)},
        'image_base64': b64_str,
        'cropped_bgr': face_crop,
        'confidence': float(conf)
    }


def _extract_face_descriptor(face_bgr: np.ndarray, target_size: Tuple[int, int] = (160, 160)) -> np.ndarray:
    """
    Extract multi-scale normalized gradient and luminance descriptors for face verification.
    """
    resized = cv2.resize(face_bgr, target_size, interpolation=cv2.INTER_AREA)
    gray = cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY)

    # Normalize illumination
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    norm_gray = clahe.apply(gray)

    # 1. Multi-scale block gradients
    sobel_x = cv2.Sobel(norm_gray, cv2.CV_32F, 1, 0, ksize=3)
    sobel_y = cv2.Sobel(norm_gray, cv2.CV_32F, 0, 1, ksize=3)
    mag, angle = cv2.cartToPolar(sobel_x, sobel_y, angleInDegrees=True)

    # Divide face into 4x4 grid (16 blocks) and compute 8-bin orientation histograms
    h, w = target_size
    bh, bw = h // 4, w // 4
    hist_list = []

    for i in range(4):
        for j in range(4):
            block_mag = mag[i * bh:(i + 1) * bh, j * bw:(j + 1) * bw]
            block_angle = angle[i * bh:(i + 1) * bh, j * bw:(j + 1) * bw]
            hist, _ = np.histogram(block_angle, bins=8, range=(0, 360), weights=block_mag)
            norm = np.linalg.norm(hist) + 1e-6
            hist_list.extend(hist / norm)

    # 2. Color channel ratios in central face region (forehead + cheeks)
    center_roi = resized[bh:3 * bh, bw:3 * bw]
    b_mean = np.mean(center_roi[:, :, 0])
    g_mean = np.mean(center_roi[:, :, 1])
    r_mean = np.mean(center_roi[:, :, 2])
    rgb_sum = b_mean + g_mean + r_mean + 1e-6
    color_feats = [r_mean / rgb_sum, g_mean / rgb_sum, b_mean / rgb_sum]

    descriptor = np.array(hist_list + color_feats, dtype=np.float32)
    norm = np.linalg.norm(descriptor) + 1e-6
    return descriptor / norm


def compare_faces(
    face1_bgr: np.ndarray,
    face2_bgr: np.ndarray,
    threshold: float = 72.0
) -> Dict[str, Any]:
    """
    Compare two cropped face images and produce a KYC similarity match score.

    Args:
        face1_bgr: First face image (e.g. from ID card/passport).
        face2_bgr: Second face image (e.g. from live selfie).
        threshold: Match cutoff percentage (default 72.0%).

    Returns:
        dict:
            success: bool
            match: bool
            similarity_percentage: float (0.0 to 100.0)
            confidence_score: float (0.0 to 1.0)
            verdict: 'VERIFIED_MATCH' | 'UNCERTAIN' | 'MISMATCH'
            threshold_applied: float
    """
    if face1_bgr is None or face2_bgr is None or face1_bgr.size == 0 or face2_bgr.size == 0:
        return {
            'success': False,
            'match': False,
            'similarity_percentage': 0.0,
            'confidence_score': 0.0,
            'verdict': 'MISMATCH',
            'threshold_applied': threshold,
            'error': 'Yuz suratlari bo\'sh yoki yaroqsiz'
        }

    # Extract descriptors
    desc1 = _extract_face_descriptor(face1_bgr)
    desc2 = _extract_face_descriptor(face2_bgr)

    # 1. Cosine similarity
    cosine_sim = float(np.dot(desc1, desc2))
    cosine_sim = max(0.0, min(1.0, cosine_sim))

    # 2. Structural correlation of central facial geometry
    f1_gray = cv2.cvtColor(cv2.resize(face1_bgr, (100, 100)), cv2.COLOR_BGR2GRAY)
    f2_gray = cv2.cvtColor(cv2.resize(face2_bgr, (100, 100)), cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    f1_norm = clahe.apply(f1_gray)
    f2_norm = clahe.apply(f2_gray)

    # Template correlation in center (eyes/nose/mouth)
    center1 = f1_norm[20:80, 20:80]
    center2 = f2_norm[20:80, 20:80]
    res = cv2.matchTemplate(center1, center2, cv2.TM_CCOEFF_NORMED)
    raw_tmpl = float(res[0][0]) if res is not None and res.size > 0 else 0.0
    tmpl_sim = max(0.0, min(1.0, (raw_tmpl + 1.0) / 2.0))  # normalize [-1, 1] to [0, 1]
    if raw_tmpl < 0:
        cosine_sim *= max(0.2, 1.0 + raw_tmpl)

    # Weighted composite score
    composite_score = (cosine_sim * 0.65) + (tmpl_sim * 0.35)

    # Map to calibrated percentage (0% to 100%)
    if composite_score <= 0.40:
        sim_pct = (composite_score / 0.40) * 45.0
    elif composite_score <= 0.70:
        sim_pct = 45.0 + ((composite_score - 0.40) / 0.30) * 30.0  # 45% -> 75%
    else:
        sim_pct = 75.0 + ((composite_score - 0.70) / 0.30) * 25.0  # 75% -> 100%

    sim_pct = round(max(0.0, min(100.0, sim_pct)), 1)
    is_match = sim_pct >= threshold

    if sim_pct >= 75.0:
        verdict = 'VERIFIED_MATCH'
    elif sim_pct >= 60.0:
        verdict = 'UNCERTAIN'
    else:
        verdict = 'MISMATCH'

    return {
        'success': True,
        'match': is_match,
        'similarity_percentage': sim_pct,
        'confidence_score': round(sim_pct / 100.0, 3),
        'verdict': verdict,
        'threshold_applied': threshold,
        'details': {
            'cosine_similarity': round(cosine_sim, 3),
            'template_correlation': round(tmpl_sim, 3),
        }
    }


def verify_kyc_selfie(
    document_bytes: bytes,
    selfie_bytes: bytes,
    threshold: float = 72.0
) -> Dict[str, Any]:
    """
    End-to-end KYC face match between an ID card/passport document and a live selfie.

    Args:
        document_bytes: Raw bytes of ID card or passport photo.
        selfie_bytes: Raw bytes of user selfie photo.
        threshold: Match threshold (default 72.0%).

    Returns:
        dict: Full verification report including cropped face images and similarity verdict.
    """
    # Decode images
    doc_arr = np.frombuffer(document_bytes, dtype=np.uint8)
    doc_img = cv2.imdecode(doc_arr, cv2.IMREAD_COLOR)

    selfie_arr = np.frombuffer(selfie_bytes, dtype=np.uint8)
    selfie_img = cv2.imdecode(selfie_arr, cv2.IMREAD_COLOR)

    if doc_img is None:
        return {
            'success': False,
            'match': False,
            'similarity_percentage': 0.0,
            'verdict': 'MISMATCH',
            'error': 'Hujjat rasmini ochib bo\'lmadi (noto\'g\'ri format)'
        }

    if selfie_img is None:
        return {
            'success': False,
            'match': False,
            'similarity_percentage': 0.0,
            'verdict': 'MISMATCH',
            'error': 'Selfie rasmini ochib bo\'lmadi (noto\'g\'ri format)'
        }

    # 1. Detect face on document
    doc_face_res = detect_and_crop_face(doc_img)
    if not doc_face_res['detected']:
        return {
            'success': False,
            'match': False,
            'similarity_percentage': 0.0,
            'verdict': 'MISMATCH',
            'error': 'Hujjatda shaxs surati aniqlanmadi (ID orqa tomoni yoki yuz ko\'rinmagan rasm)',
            'document_face': {'detected': False, 'image_base64': None},
            'selfie_face': {'detected': False, 'image_base64': None}
        }

    # 2. Detect face on selfie
    selfie_face_res = detect_and_crop_face(selfie_img, pad_ratio=0.20)
    if not selfie_face_res['detected']:
        return {
            'success': False,
            'match': False,
            'similarity_percentage': 0.0,
            'verdict': 'MISMATCH',
            'error': 'Selfie rasmida yuz aniqlanmadi (aniqroq suratga oling)',
            'document_face': {
                'detected': True,
                'image_base64': doc_face_res['image_base64'],
                'box': doc_face_res['box']
            },
            'selfie_face': {'detected': False, 'image_base64': None}
        }

    # 3. Compare faces
    comp_res = compare_faces(
        doc_face_res['cropped_bgr'],
        selfie_face_res['cropped_bgr'],
        threshold=threshold
    )

    return {
        'success': True,
        'match': comp_res['match'],
        'similarity_percentage': comp_res['similarity_percentage'],
        'confidence_score': comp_res['confidence_score'],
        'verdict': comp_res['verdict'],
        'threshold_applied': threshold,
        'document_face': {
            'detected': True,
            'image_base64': doc_face_res['image_base64'],
            'box': doc_face_res['box']
        },
        'selfie_face': {
            'detected': True,
            'image_base64': selfie_face_res['image_base64'],
            'box': selfie_face_res['box']
        },
        'details': comp_res.get('details', {})
    }
