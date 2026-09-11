"""
ocr_api/views.py — REST API Views

Endpoints:
  POST /api/v1/ocr/id/          → ID karta / passport OCR
  POST /api/v1/ocr/general/     → Umumiy matn OCR
  GET  /api/v1/health/          → Health check
  GET  /api/v1/info/            → API info & capabilities
"""

import logging
import traceback
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.parsers import MultiPartParser, FormParser

from .serializers import (
    OCRRequestSerializer,
    GeneralOCRRequestSerializer,
    OCRResponseSerializer,
)
from .ocr_engine import extract_id_card, extract_general_text

logger = logging.getLogger('ocr_api')


# ══════════════════════════════════════════════════════════════════════════════
class IDCardOCRView(APIView):
    """
    POST /api/v1/ocr/id/

    Uzbekiston ID karta va passport rasmini OCR qilish.
    Tizimli maydonlarni (ism, JSHSHIR, sana, MRZ) chiqaradi.
    """
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request, *args, **kwargs):
        client_ip = self._get_client_ip(request)
        logger.info(f"[IDCardOCR] So'rov: IP={client_ip}")

        # ── Validate input ──────────────────────────────────────────────────
        serializer = OCRRequestSerializer(data=request.data)
        if not serializer.is_valid():
            logger.warning(f"[IDCardOCR] Validatsiya xatosi: {serializer.errors}")
            return Response(
                {'error': 'Noto\'g\'ri so\'rov', 'details': serializer.errors},
                status=status.HTTP_400_BAD_REQUEST
            )

        image_file = serializer.validated_data['image']
        doc_type = serializer.validated_data.get('doc_type', 'auto')

        logger.info(
            f"[IDCardOCR] Fayl: {image_file.name}, "
            f"hajm: {image_file.size} bytes, "
            f"doc_type: {doc_type}"
        )

        # ── Process ─────────────────────────────────────────────────────────
        try:
            image_bytes = image_file.read()
            result = extract_id_card(image_bytes, doc_type=doc_type)

            http_status = status.HTTP_200_OK if result.get('success') else status.HTTP_422_UNPROCESSABLE_ENTITY

            logger.info(
                f"[IDCardOCR] Natija: success={result.get('success')}, "
                f"conf={result.get('confidence')}%, "
                f"time={result.get('processing_time_ms')}ms"
            )

            return Response(result, status=http_status)

        except Exception as e:
            tb = traceback.format_exc()
            logger.error(f"[IDCardOCR] Server xatosi: {e}\n{tb}")
            return Response(
                {
                    'error': f'Server xatosi: {str(e)}',
                    'traceback': tb if self._is_debug(request) else None,
                },
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    def _get_client_ip(self, request):
        x_forwarded = request.META.get('HTTP_X_FORWARDED_FOR')
        if x_forwarded:
            return x_forwarded.split(',')[0]
        return request.META.get('REMOTE_ADDR', 'unknown')

    def _is_debug(self, request):
        from django.conf import settings
        return settings.DEBUG


# ══════════════════════════════════════════════════════════════════════════════
class GeneralOCRView(APIView):
    """
    POST /api/v1/ocr/general/

    Har qanday rasmdagi matnni o'qish.
    ID-specific field extraction yo'q — faqat raw text + confidence.
    """
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request, *args, **kwargs):
        logger.info("[GeneralOCR] So'rov keldi")

        serializer = GeneralOCRRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(
                {'error': 'Noto\'g\'ri so\'rov', 'details': serializer.errors},
                status=status.HTTP_400_BAD_REQUEST
            )

        image_file = serializer.validated_data['image']

        try:
            image_bytes = image_file.read()
            result = extract_general_text(image_bytes)

            logger.info(
                f"[GeneralOCR] conf={result.get('confidence')}%, "
                f"time={result.get('processing_time_ms')}ms, "
                f"chars={len(result.get('raw_text', ''))}"
            )

            return Response(
                result,
                status=status.HTTP_200_OK if result.get('success') else status.HTTP_422_UNPROCESSABLE_ENTITY
            )

        except Exception as e:
            tb = traceback.format_exc()
            logger.error(f"[GeneralOCR] Xato: {e}\n{tb}")
            return Response(
                {'error': str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


# ══════════════════════════════════════════════════════════════════════════════
class HealthCheckView(APIView):
    """
    GET /api/v1/health/

    Tizim holati tekshiruvi.
    """

    def get(self, request, *args, **kwargs):
        health = {
            'status': 'ok',
            'tesseract': {'available': False, 'version': None},
            'opencv': {'available': False, 'version': None},
            'languages': [],
        }

        # Check Tesseract
        try:
            import pytesseract
            version = pytesseract.get_tesseract_version()
            health['tesseract'] = {
                'available': True,
                'version': str(version),
            }
            # Check languages
            langs = pytesseract.get_languages(config='')
            health['languages'] = langs
        except Exception as e:
            health['tesseract']['error'] = str(e)
            health['status'] = 'degraded'
            logger.warning(f"[Health] Tesseract mavjud emas: {e}")

        # Check OpenCV
        try:
            import cv2
            health['opencv'] = {
                'available': True,
                'version': cv2.__version__,
            }
        except Exception as e:
            health['opencv']['error'] = str(e)
            health['status'] = 'degraded'

        return Response(
            health,
            status=status.HTTP_200_OK if health['status'] == 'ok' else status.HTTP_503_SERVICE_UNAVAILABLE
        )


# ══════════════════════════════════════════════════════════════════════════════
class APIInfoView(APIView):
    """
    GET /api/v1/info/

    API haqida ma'lumot va integratsiya qo'llanmasi.
    """

    def get(self, request, *args, **kwargs):
        base_url = request.build_absolute_uri('/api/v1/')
        return Response({
            'name': 'O\'zbekiston Hujjat OCR API',
            'version': '1.0.0',
            'description': 'ID karta va passport rasmidan matn olish tizimi',
            'endpoints': {
                'id_card_ocr': {
                    'url': f'{base_url}ocr/id/',
                    'method': 'POST',
                    'content_type': 'multipart/form-data',
                    'fields': {
                        'image': 'Rasm fayl (JPEG/PNG/BMP/WEBP, max 10MB)',
                        'doc_type': 'id_card | passport | auto (default: auto)',
                    },
                    'description': 'ID karta/passport OCR + tizimli maydonlar'
                },
                'general_ocr': {
                    'url': f'{base_url}ocr/general/',
                    'method': 'POST',
                    'content_type': 'multipart/form-data',
                    'fields': {
                        'image': 'Rasm fayl (JPEG/PNG/BMP/WEBP, max 10MB)',
                    },
                    'description': 'Har qanday rasmdagi matn'
                },
                'health': {
                    'url': f'{base_url}health/',
                    'method': 'GET',
                    'description': 'Tizim holati'
                },
            },
            'curl_examples': {
                'id_card': (
                    f'curl -X POST {base_url}ocr/id/ '
                    f'-F "image=@passport.jpg" -F "doc_type=passport"'
                ),
                'general': (
                    f'curl -X POST {base_url}ocr/general/ '
                    f'-F "image=@image.jpg"'
                ),
            },
            'supported_languages': ['Uzbek (uzb)', 'Russian (rus)', 'English (eng)'],
            'features': [
                'Avtomatik qiyshiqlik tuzatish (deskew)',
                'Hiralık filtratsiyasi (denoise)',
                'Kontrast kuchaytirish (CLAHE)',
                'Ko\'p PSM rejimida OCR',
                'MRZ (Machine Readable Zone) parser',
                'JSHSHIR, sana, jinsi, millat extraction',
                'Uzbek/Rus/Ingliz tillarini qo\'llab-quvvatlash',
            ],
        })
