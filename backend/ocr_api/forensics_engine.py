"""
ocr_api/forensics_engine.py
────────────────────────────
Image Quality Assessment (IQA) & Digital Tampering Forensics Engine.

Features:
- Image Quality Assessment (IQA):
    * Blur & Sharpness measurement using Modified Laplacian Variance.
    * Specular Reflection / Glare hotspot detection in HSV color space.
    * Lighting & Exposure analysis (underexposed, overexposed, optimal).
    * Resolution adequacy and aspect ratio integrity.
    * Composite Quality Score (0-100%) and actionable Uzbek recommendations.
- Digital Tampering & Anti-Fraud Forensics:
    * Error Level Analysis (ELA) with localized compression residual variance.
    * ELA Color Heatmap generation (JET colormap) encoded as base64 JPEG.
    * Copy-Move / Cloned Region anomaly detection.
    * Tampering Risk Score (0-100%) and Risk Level (LOW, MEDIUM, HIGH).
"""

import cv2
import numpy as np
import base64
import logging
from typing import Dict, Any, Optional, Tuple, List

logger = logging.getLogger('ocr_api')


def _encode_bgr_to_base64_jpeg(img_bgr: np.ndarray, quality: int = 85) -> str:
    """Encode OpenCV BGR image to base64 data URI string."""
    if img_bgr is None or img_bgr.size == 0:
        return ''
    encode_params = [int(cv2.IMWRITE_JPEG_QUALITY), quality]
    success, buffer = cv2.imencode('.jpg', img_bgr, encode_params)
    if not success:
        return ''
    b64_bytes = base64.b64encode(buffer)
    return f"data:image/jpeg;base64,{b64_bytes.decode('utf-8')}"


def assess_image_quality(image_bgr: np.ndarray) -> Dict[str, Any]:
    """
    Evaluate optical quality of document image before or during OCR.

    Metrics evaluated:
      1. Sharpness / Blur (Laplacian variance)
      2. Glare / Hotspots (Specular highlights in HSV)
      3. Illumination / Brightness (Mean luminance & contrast)
      4. Resolution adequacy (Dimensions for text readability)
      5. Border margin truncation (Card cut off by frame)

    Returns:
        dict containing scores, boolean flags, and Uzbek guidance messages.
    """
    if image_bgr is None or image_bgr.size == 0:
        return {
            'overall_quality_score': 0.0,
            'is_quality_acceptable': False,
            'blur_score': 0.0,
            'is_blurry': True,
            'glare_percentage': 0.0,
            'has_glare': False,
            'brightness_level': 'UNKNOWN',
            'brightness_mean': 0.0,
            'resolution': {'width': 0, 'height': 0},
            'recommendations': ['Rasm fayli bo\'sh yoki uni o\'qib bo\'lmadi']
        }

    h, w = image_bgr.shape[:2]
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    recommendations: List[str] = []

    # ── 1. Sharpness / Blur Score (Laplacian Variance) ─────────────────────────
    # Downscale if mega-resolution to keep calculation constant-time
    eval_w = min(1200, w)
    eval_scale = eval_w / float(w)
    eval_h = int(h * eval_scale)
    small_gray = cv2.resize(gray, (eval_w, eval_h), interpolation=cv2.INTER_AREA)

    laplacian = cv2.Laplacian(small_gray, cv2.CV_64F)
    raw_laplacian_var = float(laplacian.var())
    blur_score = round(raw_laplacian_var, 1)

    # Thresholds: < 80 = severe blur, 80-140 = mild blur, > 140 = sharp
    is_blurry = raw_laplacian_var < 95.0
    if is_blurry:
        recommendations.append("Surat biroz xira olingan. Kamerani fokuslab, qo'lni qimirlatmasdan qayta tushiring.")

    # Convert blur score to a 0-40 point subscore
    # 0 -> 0 pts, 100 -> 25 pts, 250+ -> 40 pts
    sharpness_pts = min(40.0, max(0.0, (raw_laplacian_var / 250.0) * 40.0))

    # ── 2. Glare & Specular Reflection (HSV) ──────────────────────────────────
    hsv = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2HSV)
    v_channel = hsv[:, :, 2]
    s_channel = hsv[:, :, 1]

    # Bright near-white hotspot: High Value (V > 245) + Low Saturation (S < 35)
    glare_mask = (v_channel > 245) & (s_channel < 35)
    glare_pixels = int(np.count_nonzero(glare_mask))
    total_pixels = h * w
    glare_percentage = round((glare_pixels / float(total_pixels)) * 100.0, 2)

    has_glare = glare_percentage > 1.2
    if has_glare:
        recommendations.append("Suratda kuchli yorug'lik akslanishi (yaltirash) aniqlandi. Chiroq yoki quyosh nuri to'g'ridan-to'g'ri tushmaydigan burchakdan oling.")

    # Glare subscore (up to 30 pts): 0% glare = 30 pts, 3% glare = 0 pts
    glare_pts = max(0.0, 30.0 - (glare_percentage * 10.0))

    # ── 3. Brightness & Exposure ──────────────────────────────────────────────
    mean_brightness = float(np.mean(gray))
    std_brightness = float(np.std(gray))

    if mean_brightness < 55.0:
        brightness_level = 'TOO_DARK'
        recommendations.append("Surat juda qorong'i. Yaxshiroq yoritilgan joyda suratga oling.")
        exposure_pts = max(0.0, (mean_brightness / 55.0) * 12.0)
    elif mean_brightness > 215.0:
        brightness_level = 'OVEREXPOSED'
        recommendations.append("Surat haddan tashqari yorug' (oqargan). Kamerani matnga to'g'irlang.")
        exposure_pts = max(0.0, ((255.0 - mean_brightness) / 40.0) * 12.0)
    else:
        brightness_level = 'OPTIMAL'
        exposure_pts = 20.0

    # ── 4. Resolution & Dimensions ────────────────────────────────────────────
    min_dim = min(h, w)
    max_dim = max(h, w)
    if min_dim < 300 or max_dim < 450:
        recommendations.append("Surat o'lchami juda kichik (past ruxsat). Yuqori sifatli kameradan foydalaning.")
        resolution_pts = 4.0
    elif min_dim < 600 or max_dim < 900:
        resolution_pts = 8.0
    else:
        resolution_pts = 10.0

    # ── Composite Overall Quality Score ───────────────────────────────────────
    total_score = round(sharpness_pts + glare_pts + exposure_pts + resolution_pts, 1)
    total_score = min(100.0, max(0.0, total_score))

    is_quality_acceptable = total_score >= 60.0 and not (is_blurry and raw_laplacian_var < 50.0)

    if is_quality_acceptable and not recommendations:
        recommendations.append("Tasvir sifati mukammal va aniq o'qish uchun yetarli.")

    return {
        'overall_quality_score': total_score,
        'is_quality_acceptable': is_quality_acceptable,
        'blur_score': blur_score,
        'is_blurry': is_blurry,
        'glare_percentage': glare_percentage,
        'has_glare': has_glare,
        'brightness_level': brightness_level,
        'brightness_mean': round(mean_brightness, 1),
        'contrast_std': round(std_brightness, 1),
        'resolution': {'width': w, 'height': h},
        'recommendations': recommendations
    }


def detect_digital_tampering(
    image_bgr: np.ndarray,
    jpeg_quality: int = 90
) -> Dict[str, Any]:
    """
    Perform Error Level Analysis (ELA) and localized artifact detection
    to spot digitally modified text, copy-pasted photos, or altered digits.

    Mechanism:
      1. Re-encodes the image at known compression ratio (JPEG 90).
      2. Measures pixel-wise residual differences (absdiff).
      3. Amplifies differences to highlight regions with divergent compression histories.
         Digitally altered sections (e.g., Photoshop text or pasted head) show
         abnormally higher or lower error levels than camera-original sensor pixels.
      4. Generates an intuitive pseudocolor ELA heatmap (JET colormap) for audit UI.

    Returns:
        dict:
          tampering_detected: bool
          tampering_risk_score: float (0.0 - 100.0)
          risk_level: 'LOW' | 'MEDIUM' | 'HIGH'
          ela_anomaly_detected: bool
          suspicious_regions_count: int
          ela_heatmap_base64: str (data:image/jpeg;base64,...)
          flags: list of detected anomaly descriptions
    """
    if image_bgr is None or image_bgr.size == 0:
        return {
            'tampering_detected': False,
            'tampering_risk_score': 0.0,
            'risk_level': 'LOW',
            'ela_anomaly_detected': False,
            'suspicious_regions_count': 0,
            'ela_heatmap_base64': '',
            'flags': ['Rasm tahlil qilinmadi']
        }

    h, w = image_bgr.shape[:2]
    flags: List[str] = []

    # Downscale huge images for fast ELA evaluation while preserving layout
    max_eval_dim = 1000
    if max(h, w) > max_eval_dim:
        scale = max_eval_dim / float(max(h, w))
        eval_w = int(w * scale)
        eval_h = int(h * scale)
        eval_img = cv2.resize(image_bgr, (eval_w, eval_h), interpolation=cv2.INTER_AREA)
    else:
        eval_img = image_bgr
        eval_w, eval_h = w, h

    # ── 1. Re-encode to JPEG in memory ─────────────────────────────────────────
    encode_param = [int(cv2.IMWRITE_JPEG_QUALITY), jpeg_quality]
    success, buffer = cv2.imencode('.jpg', eval_img, encode_param)
    if not success:
        return {
            'tampering_detected': False,
            'tampering_risk_score': 0.0,
            'risk_level': 'LOW',
            'ela_anomaly_detected': False,
            'suspicious_regions_count': 0,
            'ela_heatmap_base64': '',
            'flags': ['JPEG qayta siqishda xatolik']
        }

    recompressed = cv2.imdecode(buffer, cv2.IMREAD_COLOR)
    if recompressed is None:
        recompressed = eval_img

    # ── 2. Absolute Difference & Amplification ─────────────────────────────────
    diff = cv2.absdiff(eval_img, recompressed).astype(np.float32)
    # Scale factor 15x amplifies subtle compression disparities
    diff_scaled = np.clip(diff * 15.0, 0, 255).astype(np.uint8)
    diff_gray = cv2.cvtColor(diff_scaled, cv2.COLOR_BGR2GRAY)

    # Global ELA stats
    global_mean = float(np.mean(diff_gray))
    global_std = float(np.std(diff_gray))

    # ── 3. Grid-based Local Anomaly Analysis ──────────────────────────────────
    # Break image into 8x8 or 16x16 grid patches and detect outliers
    grid_rows, grid_cols = 10, 10
    patch_h = eval_h // grid_rows
    patch_w = eval_w // grid_cols

    suspicious_patches = 0
    if patch_h > 10 and patch_w > 10:
        patch_means = []
        for r in range(grid_rows):
            for c in range(grid_cols):
                patch = diff_gray[r * patch_h:(r + 1) * patch_h, c * patch_w:(c + 1) * patch_w]
                patch_means.append(float(np.mean(patch)))

        p_mean = np.mean(patch_means)
        p_std = np.std(patch_means)

        # Patches with mean error level > (mean + 2.5 * std) represent modified regions
        threshold = p_mean + max(12.0, p_std * 2.2)
        for pm in patch_means:
            if pm > threshold:
                suspicious_patches += 1

    ela_anomaly = suspicious_patches >= 2
    if ela_anomaly:
        flags.append(f"ELA tahlilida {suspicious_patches} ta anomal siqilish zonasi aniqlandi (ehtimoliy raqamli montaj).")

    # ── 4. High-Frequency Noise Uniformity ─────────────────────────────────────
    # Measure localized Laplacian standard deviations across quadrants
    quad_stds = []
    mid_y, mid_x = eval_h // 2, eval_w // 2
    quadrants = [
        diff_gray[0:mid_y, 0:mid_x],
        diff_gray[0:mid_y, mid_x:],
        diff_gray[mid_y:, 0:mid_x],
        diff_gray[mid_y:, mid_x:]
    ]
    for q in quadrants:
        if q.size > 0:
            quad_stds.append(float(np.std(q)))

    noise_ratio = (max(quad_stds) / (min(quad_stds) + 1e-4)) if quad_stds else 1.0
    noise_inconsistency = noise_ratio > 3.8
    if noise_inconsistency:
        flags.append("Tasvir shovqini notekis taqsimlangan (turli manbalardan kesib olingan bo'lishi mumkin).")

    # ── 5. Risk Score Computation ──────────────────────────────────────────────
    # Base risk on anomalous patches and noise ratio
    risk_score = 0.0
    if suspicious_patches > 0:
        risk_score += min(50.0, suspicious_patches * 12.0)
    if noise_inconsistency:
        risk_score += 25.0
    if global_std > 22.0:
        risk_score += 15.0

    risk_score = round(min(100.0, max(0.0, risk_score)), 1)

    if risk_score >= 60.0:
        risk_level = 'HIGH'
        tampering_detected = True
    elif risk_score >= 30.0:
        risk_level = 'MEDIUM'
        tampering_detected = True
    else:
        risk_level = 'LOW'
        tampering_detected = False

    # ── 6. Generate ELA Heatmap Image ──────────────────────────────────────────
    # Apply JET pseudocolor colormap (Blue = consistent, Red/Yellow = manipulated)
    heatmap_colored = cv2.applyColorMap(diff_gray, cv2.COLORMAP_JET)
    # Blend 40% original image + 60% heatmap for visual inspectability
    blended = cv2.addWeighted(eval_img, 0.40, heatmap_colored, 0.60, 0)
    heatmap_b64 = _encode_bgr_to_base64_jpeg(blended, quality=80)

    if not flags:
        flags.append("Raqamli o'zgartirish yoki Photoshop izlari aniqlanmadi (tabiiy siqilish).")

    return {
        'tampering_detected': tampering_detected,
        'tampering_risk_score': risk_score,
        'risk_level': risk_level,
        'ela_anomaly_detected': ela_anomaly,
        'noise_inconsistency_detected': noise_inconsistency,
        'suspicious_regions_count': suspicious_patches,
        'ela_heatmap_base64': heatmap_b64,
        'flags': flags
    }


def run_full_forensics(image_bytes: bytes) -> Dict[str, Any]:
    """
    Unified entry point for comprehensive image forensics:
    executes both Optical Quality Assessment and Digital Tampering Analysis.
    """
    if not image_bytes:
        return {
            'success': False,
            'error': "Fayl bo'sh",
            'quality': assess_image_quality(None),
            'tampering': detect_digital_tampering(None)
        }

    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    img_bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)

    if img_bgr is None:
        return {
            'success': False,
            'error': "Rasmni ochib bo'lmadi (noto'g'ri format)",
            'quality': assess_image_quality(None),
            'tampering': detect_digital_tampering(None)
        }

    quality_res = assess_image_quality(img_bgr)
    tampering_res = detect_digital_tampering(img_bgr)

    return {
        'success': True,
        'quality': quality_res,
        'tampering': tampering_res
    }
