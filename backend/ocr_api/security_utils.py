"""
ocr_api/security_utils.py
─────────────────────────
Enterprise security and input sanitization utilities for KYC & OCR processing.
Protects against:
  - Disguised file uploads (Magic Byte verification)
  - Decompression bombs & Pixel Floods (Pillow MAX_IMAGE_PIXELS enforcement)
  - Memory exhaustion Denial-of-Service
  - Malicious metadata injection
"""

import io
from PIL import Image
from rest_framework import serializers

# Maximum allowed uncompressed image pixel count (approx 5000 x 5000 pixels)
# Prevents decompression bomb attacks from consuming gigabytes of server RAM.
MAX_PIXELS_ALLOWED = 25_000_000
MAX_FILE_BYTES = 10 * 1024 * 1024  # 10 MB

# Enforce Pillow safety limit globally
Image.MAX_IMAGE_PIXELS = MAX_PIXELS_ALLOWED

# Known image magic byte signatures (first 4-12 bytes)
MAGIC_SIGNATURES = [
    (b'\xFF\xD8\xFF', 'image/jpeg'),              # JPEG
    (b'\x89PNG\r\n\x1a\n', 'image/png'),         # PNG
    (b'RIFF', 'image/webp'),                       # WEBP (RIFF....WEBP)
    (b'BM', 'image/bmp'),                         # BMP
    (b'II*\x00', 'image/tiff'),                   # TIFF (Little-endian)
    (b'MM\x00*', 'image/tiff'),                   # TIFF (Big-endian)
]


def detect_image_mime(header_bytes: bytes) -> str:
    """
    Detect the genuine MIME type of an image buffer based on magic bytes.
    Does not trust client-supplied Content-Type headers.
    """
    if not header_bytes:
        return 'unknown'

    # Check WEBP specifically (starts with RIFF and has WEBP at offset 8)
    if header_bytes.startswith(b'RIFF') and len(header_bytes) >= 12:
        if header_bytes[8:12] == b'WEBP':
            return 'image/webp'

    for sig, mime in MAGIC_SIGNATURES:
        if header_bytes.startswith(sig):
            return mime

    return 'unknown'


def validate_image_safety(uploaded_file, max_bytes: int = MAX_FILE_BYTES) -> None:
    """
    Perform deep security validation on an uploaded image file:
      1. Enforce file size limit.
      2. Verify authentic image magic bytes.
      3. Safely open with Pillow to detect decompression bombs, corrupted headers, and pixel limits.
      4. Reset file pointer for downstream consumers.

    Raises rest_framework.serializers.ValidationError on any violation.
    """
    if not uploaded_file:
        raise serializers.ValidationError("Fayl yuklanmadi.")

    # 1. File size check
    file_size = getattr(uploaded_file, 'size', 0)
    if file_size > max_bytes:
        max_mb = max_bytes // (1024 * 1024)
        raise serializers.ValidationError(f"Fayl hajmi {max_mb} MB dan oshmasligi kerak.")

    # Read first 16 bytes for magic byte verification
    uploaded_file.seek(0)
    header = uploaded_file.read(16)
    uploaded_file.seek(0)

    detected_mime = detect_image_mime(header)
    allowed_mimes = {'image/jpeg', 'image/png', 'image/webp', 'image/bmp', 'image/tiff'}
    if detected_mime not in allowed_mimes:
        raise serializers.ValidationError(
            "Fayl formati yaroqsiz yoki soxtalashtirilgan. Faqat haqiqiy JPEG, PNG, WEBP, BMP, TIFF formatlar qabul qilinadi."
        )

    # 2. Pillow integrity and decompression bomb check
    try:
        uploaded_file.seek(0)
        img_bytes = uploaded_file.read()
        uploaded_file.seek(0)

        with Image.open(io.BytesIO(img_bytes)) as img:
            img.verify()  # Fast structural verification without decoding entire raster

        # Re-check dimensions
        with Image.open(io.BytesIO(img_bytes)) as img:
            width, height = img.size
            if width * height > MAX_PIXELS_ALLOWED:
                raise serializers.ValidationError(
                    f"Rasm o'lchamlari ruxsat etilgan maksimal chegaradan ({MAX_PIXELS_ALLOWED} piksel) katta."
                )
            if width < 100 or height < 100:
                raise serializers.ValidationError(
                    "Rasm o'lchami juda kichik (kamida 100x100 piksel bo'lishi shart)."
                )

    except serializers.ValidationError:
        raise
    except Image.DecompressionBombError:
        raise serializers.ValidationError(
            "Xavfsizlik xatosi: Tasvir juda katta hajmga dekompressiya bo'ladi (Decompression Bomb taqiqlangan)."
        )
    except Exception as exc:
        raise serializers.ValidationError(f"Tasvir fayli buzilgan yoki o'qib bo'lmaydi: {str(exc)}")
    finally:
        uploaded_file.seek(0)
