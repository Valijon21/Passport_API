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

from drf_spectacular.utils import extend_schema, OpenApiParameter, OpenApiExample
from .serializers import (
    OCRRequestSerializer,
    GeneralOCRRequestSerializer,
    OCRResponseSerializer,
    FaceMatchRequestSerializer,
    FaceMatchResponseSerializer,
)
from .ocr_engine import extract_id_card, extract_general_text
from .face_engine import verify_kyc_selfie
import time

logger = logging.getLogger('ocr_api')



# ══════════════════════════════════════════════════════════════════════════════
class IDCardOCRView(APIView):
    """
    POST /api/v1/ocr/id/

    Uzbekiston ID karta va passport rasmini OCR qilish.
    Tizimli maydonlarni (ism, JSHSHIR, sana, MRZ) chiqaradi.
    """
    parser_classes = [MultiPartParser, FormParser]

    @extend_schema(
        tags=['Hujjat OCR & Tahlil'],
        summary="O'zbekiston ID karta yoki Biometrik Pasportini skanerlash",
        description=(
            "ID karta (old/orqa) yoki pasport rasmini qabul qiladi. "
            "Tasvirni avtomatik to'g'irlaydi (deskew), matnlarni OCR qiladi, "
            "ICAO 9303 MRZ 7-3-1 nazorat sonlarini tekshiradi, JSHSHIR orqali kross-tekshiruv "
            "(Anti-Fraud) o'tkazadi va shaxsning yuz suratini (Face Crop) qirqib olib beradi."
        ),
        request=OCRRequestSerializer,
        responses={
            200: OCRResponseSerializer,
            400: {'type': 'object', 'properties': {'error': {'type': 'string'}, 'details': {'type': 'object'}}},
            422: {'type': 'object', 'properties': {'error': {'type': 'string'}}},
            500: {'type': 'object', 'properties': {'error': {'type': 'string'}}},
        }
    )
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

    @extend_schema(
        tags=['Hujjat OCR & Tahlil'],
        summary="Har qanday tasvirdan oddiy matnni o'qish (General OCR)",
        description="Ixtiyoriy hujjat yoki rasmdagi matnni o'qiydi (hujjat maydonlariga ajratmasdan).",
        request=GeneralOCRRequestSerializer,
        responses={
            200: {'type': 'object', 'properties': {'success': {'type': 'boolean'}, 'raw_text': {'type': 'string'}, 'confidence': {'type': 'number'}, 'processing_time_ms': {'type': 'number'}}},
            400: {'type': 'object', 'properties': {'error': {'type': 'string'}, 'details': {'type': 'object'}}},
            422: {'type': 'object', 'properties': {'error': {'type': 'string'}}},
            500: {'type': 'object', 'properties': {'error': {'type': 'string'}}},
        }
    )
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
class FaceMatchView(APIView):
    """
    POST /api/v1/kyc/face-match/

    KYC 1:1 Face Match tekshiruvi.
    ID karta/pasportdagi surat bilan foydalanuvchining jonli selfisini solishtiradi.
    """
    parser_classes = [MultiPartParser, FormParser]

    @extend_schema(
        tags=['KYC & Biometriya'],
        summary="1:1 Face Match: Hujjat surati va Jonli Selfie solishtiruvi (KYC)",
        description=(
            "ID karta/pasport rasmi va foydalanuvchining jonli selfisini solishtiradi. "
            "Ikkala rasmdan ham yuzlarni avtomatik qirqib oladi, biometrik descriptorlarni "
            "tahlil qilib, 0.0% dan 100.0% gacha bo'lgan moslik foizini va rasmiy xulosani chiqaradi."
        ),
        request=FaceMatchRequestSerializer,
        responses={
            200: FaceMatchResponseSerializer,
            400: {'type': 'object', 'properties': {'error': {'type': 'string'}, 'details': {'type': 'object'}}},
            422: FaceMatchResponseSerializer,
            500: {'type': 'object', 'properties': {'error': {'type': 'string'}}},
        }
    )
    def post(self, request, *args, **kwargs):
        logger.info("[FaceMatch] KYC solishtiruv so'rovi keldi")
        t_start = time.time()

        serializer = FaceMatchRequestSerializer(data=request.data)
        if not serializer.is_valid():
            logger.warning(f"[FaceMatch] Validatsiya xatosi: {serializer.errors}")
            return Response(
                {'error': 'Noto\'g\'ri so\'rov', 'details': serializer.errors},
                status=status.HTTP_400_BAD_REQUEST
            )

        doc_file = serializer.validated_data['document_image']
        selfie_file = serializer.validated_data['selfie_image']
        threshold = serializer.validated_data.get('threshold', 72.0)

        try:
            doc_bytes = doc_file.read()
            selfie_bytes = selfie_file.read()

            result = verify_kyc_selfie(doc_bytes, selfie_bytes, threshold=threshold)
            result['processing_time_ms'] = round((time.time() - t_start) * 1000, 1)

            logger.info(
                f"[FaceMatch] Natija: match={result.get('match')}, "
                f"sim={result.get('similarity_percentage')}%, "
                f"verdict={result.get('verdict')}, time={result['processing_time_ms']}ms"
            )

            http_status = status.HTTP_200_OK if result.get('success') else status.HTTP_422_UNPROCESSABLE_ENTITY
            return Response(result, status=http_status)

        except Exception as e:
            tb = traceback.format_exc()
            logger.error(f"[FaceMatch] Server xatosi: {e}\n{tb}")
            return Response(
                {'error': f'Server xatosi: {str(e)}', 'success': False, 'match': False},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


# ══════════════════════════════════════════════════════════════════════════════
class HealthCheckView(APIView):
    """
    GET /api/v1/health/

    Tizim holati tekshiruvi.
    """

    @extend_schema(
        tags=['Tizim Monitoringi'],
        summary="Tizim sog'lig'i va OCR dvigatellari holati",
        description="Tesseract OCR, OpenCV va o'rnatilgan tillar holatini tekshiradi.",
        responses={200: {'type': 'object', 'properties': {'status': {'type': 'string'}, 'tesseract': {'type': 'object'}, 'opencv': {'type': 'object'}, 'languages': {'type': 'array', 'items': {'type': 'string'}}}}}
    )

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

    @extend_schema(
        tags=['Tizim Monitoringi'],
        summary="API xususiyatlari, imkoniyatlari va integratsiya yo'riqnomasi",
        description="Barcha mavjud endpointlar, parametrlar, qo'llab-quvvatlanuvchi tillar va cURL misollari.",
        responses={200: {'type': 'object', 'properties': {'name': {'type': 'string'}, 'version': {'type': 'string'}, 'endpoints': {'type': 'object'}}}}
    )
    def get(self, request, *args, **kwargs):
        base_url = request.build_absolute_uri('/api/v1/')
        return Response({
            'name': 'O\'zbekiston Hujjat OCR va KYC API',
            'version': '1.2.0',
            'description': 'ID karta, pasport OCR, ICAO 9303, JSHSHIR Anti-Fraud va 1:1 Face Match tizimi',
            'endpoints': {
                'id_card_ocr': {
                    'url': f'{base_url}ocr/id/',
                    'method': 'POST',
                    'content_type': 'multipart/form-data',
                    'fields': {
                        'image': 'Rasm fayl (JPEG/PNG/BMP/WEBP, max 10MB)',
                        'doc_type': 'id_card | passport | auto (default: auto)',
                    },
                    'description': 'ID karta/passport OCR + tizimli maydonlar + Face crop + Anti-Fraud'
                },
                'kyc_face_match': {
                    'url': f'{base_url}kyc/face-match/',
                    'method': 'POST',
                    'content_type': 'multipart/form-data',
                    'fields': {
                        'document_image': 'ID karta yoki pasport rasmi (max 10MB)',
                        'selfie_image': 'Jonli selfie fotosurati (max 10MB)',
                        'threshold': 'Moslik chegarasi foizda (standart: 72.0)',
                    },
                    'description': '1:1 KYC Face Match biometrik tekshiruvi'
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
