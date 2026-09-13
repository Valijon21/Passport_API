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
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser

from drf_spectacular.utils import extend_schema, OpenApiParameter, OpenApiExample
from .serializers import (
    OCRRequestSerializer,
    GeneralOCRRequestSerializer,
    OCRResponseSerializer,
    FaceMatchRequestSerializer,
    FaceMatchResponseSerializer,
    IDCardFullRequestSerializer,
    IDCardFullResponseSerializer,
    DossierPDFRequestSerializer,
    DossierPDFResponseSerializer,
    ForensicsRequestSerializer,
    ForensicsResponseSerializer,
    LivenessChallengeRequestSerializer,
    LivenessChallengeResponseSerializer,
    LivenessVerifyRequestSerializer,
    LivenessVerifyResponseSerializer,
)
from .ocr_engine import extract_id_card, extract_general_text, extract_id_card_full
from .face_engine import verify_kyc_selfie
from .forensics_engine import run_full_forensics
from .pdf_engine import process_dossier_pdf
from .liveness_engine import generate_liveness_challenge, verify_liveness_session
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
class IDCardFullOCRView(APIView):
    """
    POST /api/v1/ocr/id-full/

    ID karta old va orqa tomonlarini birgalikda tahlil qilish (Smart Two-Sided Merge).
    Old tomondan: Ism, Familiya, Sharif, Hujjat raqami, Yuz surati (Face Crop);
    Orqa tomondan: 14 xonali JSHSHIR, Tug'ilgan joyi, Amal qilish muddati va 3 qatorli TD1 MRZ.
    Anti-Fraud kross-tekshiruv va avtomatik teskari tomonlarni tuzatish (Auto-Swap).
    """
    parser_classes = [MultiPartParser, FormParser]

    @extend_schema(
        tags=['Hujjat OCR & Tahlil'],
        summary="ID Karta Old va Orqa tomonini birlashtirish (Two-Sided Smart Merge)",
        description=(
            "Foydalanuvchi bir vaqtning o'zida O'zbekiston ID kartasining old (`front_image`) va "
            "orqa (`back_image`) tomonlarini yuklaydi. "
            "Tizim ikkala tomonni parallel tahlil qiladi, agar foydalanuvchi ularni adashtirib "
            "teskari yuklagan bo'lsa, avtomatik ravishda to'g'irlaydi (Auto-Swap), "
            "hujjat raqamlari, tug'ilgan sanalari, ism-familiyalari va JSHSHIR bo'yicha "
            "kross-tekshiruv (Anti-Fraud) o'tkazadi va 100% to'liq fuqaro profilini taqdim etadi."
        ),
        request=IDCardFullRequestSerializer,
        responses={
            200: IDCardFullResponseSerializer,
            400: {'type': 'object', 'properties': {'error': {'type': 'string'}, 'details': {'type': 'object'}}},
            422: {'type': 'object', 'properties': {'error': {'type': 'string'}}},
            500: {'type': 'object', 'properties': {'error': {'type': 'string'}}},
        }
    )
    def post(self, request, *args, **kwargs):
        client_ip = self._get_client_ip(request)
        logger.info(f"[IDCardFullOCR] So'rov: IP={client_ip}")

        serializer = IDCardFullRequestSerializer(data=request.data)
        if not serializer.is_valid():
            logger.warning(f"[IDCardFullOCR] Validatsiya xatosi: {serializer.errors}")
            return Response(
                {'error': "Noto'g'ri so'rov", 'details': serializer.errors},
                status=status.HTTP_400_BAD_REQUEST
            )

        front_file = serializer.validated_data['front_image']
        back_file = serializer.validated_data['back_image']

        logger.info(
            f"[IDCardFullOCR] Fayllar: Front='{front_file.name}' ({front_file.size}b), "
            f"Back='{back_file.name}' ({back_file.size}b)"
        )

        try:
            front_bytes = front_file.read()
            back_bytes = back_file.read()

            result = extract_id_card_full(front_bytes, back_bytes)

            http_status = status.HTTP_200_OK if result.get('success') else status.HTTP_422_UNPROCESSABLE_ENTITY

            logger.info(
                f"[IDCardFullOCR] Natija: success={result.get('success')}, "
                f"status={result.get('validation', {}).get('overall_status')}, "
                f"swapped={result.get('auto_swapped')}, "
                f"time={result.get('processing_time_ms')}ms"
            )

            return Response(result, status=http_status)

        except Exception as e:
            tb = traceback.format_exc()
            logger.error(f"[IDCardFullOCR] Server xatosi: {e}\n{tb}")
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
class DossierPDFOCRView(APIView):
    """
    POST /api/v1/ocr/dossier-pdf/

    Ko'p sahifali PDF arizalarni tahlil qilish (Scanned Dossier OCR).
    ID old va orqa tomonlarini avtomatik ajratib, Two-Sided Smart Merge
    orqali yagona fuqaro profilini yaratadi.
    """
    parser_classes = [MultiPartParser, FormParser]

    @extend_schema(
        tags=['Hujjat OCR & Tahlil'],
        summary="Ko'p sahifali PDF Hujjatlarni Avtomatik Tahlil Qilish (Scanned Dossier)",
        description=(
            "Bank va lizing arizalaridagi ko'p sahifali PDF faylni qabul qiladi. "
            "Har bir sahifani ajratadi, ID old, ID orqa yoki pasport sahifalarini klassifikatsiya qiladi, "
            "hamda ID kartaning ikkala tomoni topilganda Two-Sided Smart Merge orqali yaxlit profil taqdim etadi."
        ),
        request=DossierPDFRequestSerializer,
        responses={
            200: DossierPDFResponseSerializer,
            400: {'type': 'object', 'properties': {'error': {'type': 'string'}, 'details': {'type': 'object'}}},
            422: {'type': 'object', 'properties': {'error': {'type': 'string'}}},
            500: {'type': 'object', 'properties': {'error': {'type': 'string'}}},
        }
    )
    def post(self, request, *args, **kwargs):
        client_ip = self._get_client_ip(request)
        logger.info(f"[DossierPDF] So'rov: IP={client_ip}")

        serializer = DossierPDFRequestSerializer(data=request.data)
        if not serializer.is_valid():
            logger.warning(f"[DossierPDF] Validatsiya xatosi: {serializer.errors}")
            return Response(
                {'error': "Noto'g'ri so'rov", 'details': serializer.errors},
                status=status.HTTP_400_BAD_REQUEST
            )

        pdf_file = serializer.validated_data['file']
        max_pages = serializer.validated_data.get('max_pages', 10)
        logger.info(f"[DossierPDF] Fayl: '{pdf_file.name}' ({pdf_file.size}b), max_pages={max_pages}")

        try:
            pdf_bytes = pdf_file.read()
            result = process_dossier_pdf(pdf_bytes, max_pages=max_pages)
            http_status = status.HTTP_200_OK if result.get('success') else status.HTTP_422_UNPROCESSABLE_ENTITY
            return Response(result, status=http_status)
        except Exception as e:
            tb = traceback.format_exc()
            logger.error(f"[DossierPDF] Server xatosi: {e}\n{tb}")
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
class ImageForensicsView(APIView):
    """
    POST /api/v1/ocr/forensics/

    Rasm Sifatini Baholash (Laplacian blur, glare) va Soxtalik Forensikasi (ELA heatmap, tampering risk).
    """
    parser_classes = [MultiPartParser, FormParser]

    @extend_schema(
        tags=['Hujjat OCR & Tahlil'],
        summary="Rasm Sifatini Baholash va Soxtalik Forensikasi (Tampering & Quality Forensics)",
        description=(
            "Yuklangan rasmning optik sifatini (Laplacian blur score, yaltirash/glare, yorug'lik) "
            "va raqamli soxtalashtirish alomatlarini (Error Level Analysis ELA, shovqin anomaliyalari) "
            "aniqlaydi hamda auditorlik tekshiruvi uchun JET issiqlik xaritasi (Heatmap) beradi."
        ),
        request=ForensicsRequestSerializer,
        responses={
            200: ForensicsResponseSerializer,
            400: {'type': 'object', 'properties': {'error': {'type': 'string'}, 'details': {'type': 'object'}}},
            500: {'type': 'object', 'properties': {'error': {'type': 'string'}}},
        }
    )
    def post(self, request, *args, **kwargs):
        t_start = time.time()
        serializer = ForensicsRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(
                {'error': "Noto'g'ri so'rov", 'details': serializer.errors},
                status=status.HTTP_400_BAD_REQUEST
            )

        image_file = serializer.validated_data['image']
        try:
            img_bytes = image_file.read()
            forensics_res = run_full_forensics(img_bytes)
            elapsed_ms = round((time.time() - t_start) * 1000.0, 1)
            forensics_res['processing_time_ms'] = elapsed_ms
            return Response(forensics_res, status=status.HTTP_200_OK)
        except Exception as e:
            tb = traceback.format_exc()
            logger.error(f"[ImageForensics] Server xatosi: {e}\n{tb}")
            return Response(
                {'error': f'Server xatosi: {str(e)}', 'success': False},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


# ══════════════════════════════════════════════════════════════════════════════
class LivenessChallengeView(APIView):
    """
    POST /api/v1/kyc/liveness/challenge/

    Faol jonlilik (Active Liveness) uchun HMAC bilan imzolangan dinamik topshiriqlar sessiyasini ochadi.
    """
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    @extend_schema(
        tags=['KYC & Biometriya'],
        summary="Jonlilik sessiyasini ochish va topshiriqlarni olish (Liveness Challenge)",
        description=(
            "Foydalanuvchiga bajarish uchun 2-3 ta tasodifiy dinamik harakat buyrug'i "
            "('O'ngga qarang', 'Chapga qarang', 'Yaqinroq keling', 'Uzoqroq qiling', 'Jilmaying') "
            "va 90 soniyalik HMAC-SHA256 kriptografik xavfsiz token generatsiya qiladi."
        ),
        request=LivenessChallengeRequestSerializer,
        responses={
            200: LivenessChallengeResponseSerializer,
            400: {'type': 'object', 'properties': {'error': {'type': 'string'}}},
            500: {'type': 'object', 'properties': {'error': {'type': 'string'}}},
        }
    )
    def post(self, request, *args, **kwargs):
        serializer = LivenessChallengeRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(
                {'error': "Noto'g'ri so'rov", 'details': serializer.errors},
                status=status.HTTP_400_BAD_REQUEST
            )

        num_challenges = serializer.validated_data.get('num_challenges', 2)
        challenge_data = generate_liveness_challenge(num_challenges=num_challenges)
        return Response(challenge_data, status=status.HTTP_200_OK)


# ══════════════════════════════════════════════════════════════════════════════
class LivenessVerifyView(APIView):
    """
    POST /api/v1/kyc/liveness/verify/

    Jonlilik kadrlarini tahlil qilish, harakatlarni tasdiqlash va passiv anti-spoofing tekshiruvi.
    """
    parser_classes = [MultiPartParser, FormParser]

    @extend_schema(
        tags=['KYC & Biometriya'],
        summary="Jonlilik kadrlarini tasdiqlash va Anti-Spoofing (Liveness Verify)",
        description=(
            "Challenge tokeni va foydalanuvchining harakat kadrlarini qabul qiladi. "
            "Harakat ketma-ketligi to'g'ri bajarilganligini, hamda ekrandan qayta ko'rsatish "
            "(Moiré tahlili) yoki qog'oz printdan soxtalashtirishni tekshiradi."
        ),
        request=LivenessVerifyRequestSerializer,
        responses={
            200: LivenessVerifyResponseSerializer,
            400: {'type': 'object', 'properties': {'error': {'type': 'string'}, 'details': {'type': 'object'}}},
            422: {'type': 'object', 'properties': {'error': {'type': 'string'}}},
            500: {'type': 'object', 'properties': {'error': {'type': 'string'}}},
        }
    )
    def post(self, request, *args, **kwargs):
        token = request.data.get('token')
        if not token:
            return Response(
                {'error': "Sessiya tokeni taqdim etilmadi ('token')."},
                status=status.HTTP_400_BAD_REQUEST
            )

        frame_files = request.FILES.getlist('frames')
        if not frame_files:
            i = 0
            while f'frame_{i}' in request.FILES:
                frame_files.append(request.FILES[f'frame_{i}'])
                i += 1

        if len(frame_files) < 2:
            return Response(
                {'error': "Kamida 2 ta kadr taqdim etilishi shart ('frames')."},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            frames_bytes = [f.read() for f in frame_files]
            verify_res = verify_liveness_session(token, frames_bytes)
            http_status = status.HTTP_200_OK if verify_res.get('success') else status.HTTP_422_UNPROCESSABLE_ENTITY
            return Response(verify_res, status=http_status)
        except Exception as e:
            tb = traceback.format_exc()
            logger.error(f"[LivenessVerify] Server xatosi: {e}\n{tb}")
            return Response(
                {'error': f'Server xatosi: {str(e)}', 'success': False},
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
            'name': 'O\'zbekiston Hujjat OCR, KYC & Biometriya FinTech Platformasi',
            'version': '1.5.0',
            'description': 'ID karta, pasport OCR, Two-Sided Smart Merge, Ko\'p sahifali PDF Dossier, Forensika & Faol Jonlilik (Liveness) tizimi',
            'endpoints': {
                'id_card_ocr': {
                    'url': f'{base_url}ocr/id/',
                    'method': 'POST',
                    'content_type': 'multipart/form-data',
                    'description': 'ID karta/passport OCR + tizimli maydonlar + Face crop + Anti-Fraud'
                },
                'id_card_full': {
                    'url': f'{base_url}ocr/id-full/',
                    'method': 'POST',
                    'content_type': 'multipart/form-data',
                    'description': 'ID karta old va orqa tomonlarini bir vaqtda tahlil qilish (Two-Sided Smart Merge)'
                },
                'dossier_pdf': {
                    'url': f'{base_url}ocr/dossier-pdf/',
                    'method': 'POST',
                    'content_type': 'multipart/form-data',
                    'description': 'Ko\'p sahifali PDF arizalarni tahlil qilish (Scanned Dossier OCR)'
                },
                'forensics': {
                    'url': f'{base_url}ocr/forensics/',
                    'method': 'POST',
                    'content_type': 'multipart/form-data',
                    'description': 'Rasm sifati (Laplacian blur, glare) va Error Level Analysis (ELA) soxtalik tahlili'
                },
                'kyc_face_match': {
                    'url': f'{base_url}kyc/face-match/',
                    'method': 'POST',
                    'content_type': 'multipart/form-data',
                    'description': '1:1 KYC Face Match biometrik solishtiruvi'
                },
                'liveness_challenge': {
                    'url': f'{base_url}kyc/liveness/challenge/',
                    'method': 'POST',
                    'content_type': 'application/json',
                    'description': 'Faol jonlilik uchun HMAC-SHA256 imzolangan dinamik topshiriqlar sessiyasi'
                },
                'liveness_verify': {
                    'url': f'{base_url}kyc/liveness/verify/',
                    'method': 'POST',
                    'content_type': 'multipart/form-data',
                    'description': 'Jonlilik kadrlarini tahlil qilish va passiv Anti-Spoofing tekshiruvi'
                },
                'general_ocr': {
                    'url': f'{base_url}ocr/general/',
                    'method': 'POST',
                    'content_type': 'multipart/form-data',
                    'description': 'Har qanday rasmdagi umumiy matn'
                },
                'health': {
                    'url': f'{base_url}health/',
                    'method': 'GET',
                    'description': 'Tizim sog\'lig\'i va monitoring'
                },
            },
            'supported_languages': ['Uzbek (uzb)', 'Russian (rus)', 'English (eng)'],
            'features': [
                'Avtomatik qiyshiqlik tuzatish (deskew) va adaptiv binarizatsiya',
                'Hiralık (Laplacian variance) va yaltirash (specular glare) tahlili',
                'Error Level Analysis (ELA) va Photoshop/montaj aniqlash',
                'Ko\'p sahifali PDF arizalarni avtomatik tahlil qilish (pypdfium2)',
                'ID karta old va orqa tomonini avtomatik birlashtirish (Two-Sided Smart Merge)',
                'Auto-Swap: teskari yuklangan tomonlarni avtomatik aniqlash',
                'Interaktiv Faol Jonlilik (Active Liveness: bosh burish, yaqinlashish, miltillash)',
                'Passiv Anti-Spoofing: Moiré ekran to\'rlari va qog\'oz print tekshiruvi',
                'Kamerada hujjatni avtomatik tutib olish (Guided Auto-Capture HUD)',
                '1:1 KYC Face Match biometrik solishtiruvi',
                'ICAO 9303 MRZ 7-3-1 nazorati va JSHSHIR (PINFL) 14 xonali kross-tekshiruv',
            ],
        })
