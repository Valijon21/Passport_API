"""ocr_api/serializers.py — Request/Response serializers"""
from rest_framework import serializers
from .security_utils import validate_image_safety


class OCRRequestSerializer(serializers.Serializer):
    """Validate incoming OCR request."""
    image = serializers.ImageField(
        required=True,
        help_text="ID karta yoki passport rasmi (JPEG/PNG/BMP/WEBP, max 10MB)"
    )
    doc_type = serializers.ChoiceField(
        choices=['id_card', 'passport', 'auto'],
        default='auto',
        required=False,
        help_text="Hujjat turi"
    )

    def validate_image(self, value):
        validate_image_safety(value)
        return value


class GeneralOCRRequestSerializer(serializers.Serializer):
    """Validate general text OCR request."""
    image = serializers.ImageField(
        required=True,
        help_text="Har qanday rasm (JPEG/PNG, max 10MB)"
    )

    def validate_image(self, value):
        validate_image_safety(value)
        return value


class StructuredFieldsSerializer(serializers.Serializer):
    """Structured ID fields in response."""
    document_number = serializers.CharField(allow_null=True)
    jshshir = serializers.CharField(allow_null=True)
    surname = serializers.CharField(allow_null=True)
    first_name = serializers.CharField(allow_null=True)
    patronymic = serializers.CharField(allow_null=True)
    birth_date = serializers.CharField(allow_null=True)
    expiry_date = serializers.CharField(allow_null=True)
    issue_date = serializers.CharField(allow_null=True)
    gender = serializers.CharField(allow_null=True)
    nationality = serializers.CharField(allow_null=True)
    birth_place = serializers.CharField(allow_null=True)
    issuing_authority = serializers.CharField(allow_null=True)
    raw_lines = serializers.ListField(child=serializers.CharField())


class OCRResponseSerializer(serializers.Serializer):
    """Full OCR response schema."""
    success = serializers.BooleanField()
    doc_type = serializers.CharField()
    raw_text = serializers.CharField()
    structured_fields = StructuredFieldsSerializer(allow_null=True)
    mrz = serializers.DictField(allow_null=True)
    validation = serializers.DictField(allow_null=True, required=False)
    face = serializers.DictField(allow_null=True, required=False)
    confidence = serializers.FloatField()
    processing_time_ms = serializers.FloatField()
    debug = serializers.DictField()
    error = serializers.CharField(allow_null=True)


MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB
ALLOWED_CONTENT_TYPES = [
    'image/jpeg',
    'image/png',
    'image/bmp',
    'image/webp',
    'image/tiff',
    'image/pjpeg',
    'image/x-png',
    'application/octet-stream',
]


class FaceMatchRequestSerializer(serializers.Serializer):
    """KYC 1:1 Face Match so'rovi uchun serializer."""
    document_image = serializers.ImageField(
        required=True,
        help_text="ID karta yoki pasport fotosurati (JPEG/PNG/WEBP, maks 10 MB)"
    )
    selfie_image = serializers.ImageField(
        required=True,
        help_text="Foydalanuvchining jonli selfie fotosurati (JPEG/PNG/WEBP, maks 10 MB)"
    )
    threshold = serializers.FloatField(
        required=False,
        default=72.0,
        min_value=10.0,
        max_value=99.0,
        help_text="Moslik bo'sag'asi foizda (standart: 72.0%)"
    )

    def validate_document_image(self, value):
        validate_image_safety(value)
        return value

    def validate_selfie_image(self, value):
        validate_image_safety(value)
        return value


class FaceMatchResponseSerializer(serializers.Serializer):
    """KYC 1:1 Face Match natijasi uchun serializer."""
    success = serializers.BooleanField(help_text="Tahlil muvaffaqiyati")
    match = serializers.BooleanField(help_text="Shaxs mos keldimi (True / False)")
    similarity_percentage = serializers.FloatField(help_text="Moslik foizi (0.0% - 100.0%)")
    confidence_score = serializers.FloatField(help_text="Ishonchlilik koeffitsienti (0.0 - 1.0)")
    verdict = serializers.CharField(help_text="Xulosa: VERIFIED_MATCH, UNCERTAIN yoki MISMATCH")
    threshold_applied = serializers.FloatField(help_text="Qo'llanilgan bo'sag'a qiymati")
    document_face = serializers.DictField(allow_null=True, help_text="Hujjatdan qirqilgan yuz surati va koordinatalari")
    selfie_face = serializers.DictField(allow_null=True, help_text="Selfiedan qirqilgan yuz surati va koordinatalari")
    details = serializers.DictField(required=False, help_text="Algoritm ichki ko'rsatkichlari (cosine similarity, correlation)")
    processing_time_ms = serializers.FloatField(required=False, help_text="Tahlil vaqti millisekundlarda")
    error = serializers.CharField(allow_null=True, required=False, help_text="Xatolik xabari")


class IDCardFullRequestSerializer(serializers.Serializer):
    """ID karta old va orqa tomonlarini bir vaqtda yuklash uchun serializer."""
    front_image = serializers.ImageField(
        required=True,
        help_text="ID kartaning old tomoni rasmi (JPEG/PNG/WEBP/BMP, maks 10MB)"
    )
    back_image = serializers.ImageField(
        required=True,
        help_text="ID kartaning orqa tomoni rasmi (JPEG/PNG/WEBP/BMP, maks 10MB)"
    )

    def validate_front_image(self, value):
        validate_image_safety(value)
        return value

    def validate_back_image(self, value):
        validate_image_safety(value)
        return value


class CitizenProfileSerializer(serializers.Serializer):
    """100% To'liq fuqaro profili (ikkala tomon birlashgan holatda)."""
    document_type = serializers.CharField(default="ID_CARD")
    document_number = serializers.CharField(allow_null=True)
    personal_number = serializers.CharField(allow_null=True, help_text="14 xonali JSHSHIR / PINFL")
    surname = serializers.CharField(allow_null=True)
    first_name = serializers.CharField(allow_null=True)
    patronymic = serializers.CharField(allow_null=True)
    full_name = serializers.CharField(allow_null=True)
    date_of_birth = serializers.CharField(allow_null=True)
    place_of_birth = serializers.CharField(allow_null=True)
    date_of_issue = serializers.CharField(allow_null=True)
    date_of_expiry = serializers.CharField(allow_null=True)
    issuing_authority = serializers.CharField(allow_null=True)
    gender = serializers.CharField(allow_null=True)
    nationality = serializers.CharField(allow_null=True)


class IDCardFullResponseSerializer(serializers.Serializer):
    """POST /api/v1/ocr/id-full/ so'rovi uchun to'liq javob sxemasi."""
    success = serializers.BooleanField()
    document_type = serializers.CharField()
    citizen_profile = CitizenProfileSerializer()
    validation = serializers.DictField(help_text="Kross-tekshiruv, Anti-Fraud va ICAO tekshiruv natijalari")
    face = serializers.DictField(allow_null=True, help_text="Hujjat old tomonidan qirqilgan biometrik yuz surati")
    mrz = serializers.DictField(allow_null=True, help_text="Hujjat orqa tomonidan olingan 3 qatorli TD1 MRZ")
    confidence = serializers.FloatField(help_text="Ikkala tomon bo'yicha umumiy aniqlik ko'rsatkichi")
    auto_swapped = serializers.BooleanField(help_text="Foydalanuvchi old va orqa tomonlarni almashtirib yuborgan bo'lsa avtomatik tuzatildi")
    front_side = serializers.DictField(required=False, help_text="Old tomonning xom OCR natijalari")
    back_side = serializers.DictField(required=False, help_text="Orqa tomonning xom OCR natijalari")
    processing_time_ms = serializers.FloatField()
    error = serializers.CharField(allow_null=True, required=False)


# ── PDF Dossier Serializers ───────────────────────────────────────────────────

MAX_PDF_SIZE = 25 * 1024 * 1024  # 25 MB


class DossierPDFRequestSerializer(serializers.Serializer):
    """Ko'p sahifali PDF arizalar uchun so'rov serializeri."""
    file = serializers.FileField(
        required=True,
        help_text="Ko'p sahifali PDF arizasi yoki hujjati (PDF format, maks 25 MB)"
    )
    max_pages = serializers.IntegerField(
        required=False,
        default=10,
        min_value=1,
        max_value=20,
        help_text="Tahlil qilinadigan maksimal sahifalar soni (standart: 10)"
    )

    def validate_file(self, value):
        if value.size > MAX_PDF_SIZE:
            raise serializers.ValidationError("PDF fayl hajmi 25 MB dan oshmasligi kerak.")
        filename = getattr(value, 'name', '') or ''
        if not filename.lower().endswith('.pdf'):
            raise serializers.ValidationError("Faqat PDF formatdagi fayllar qabul qilinadi (.pdf).")
        # Validate %PDF- magic bytes
        value.seek(0)
        magic = value.read(5)
        value.seek(0)
        if not magic.startswith(b'%PDF-'):
            raise serializers.ValidationError("Fayl haqiqiy PDF emas yoki fayl sarlavhasi shikastlangan.")
        return value


class DossierPDFResponseSerializer(serializers.Serializer):
    """Ko'p sahifali PDF tahlili javob sxemasi."""
    success = serializers.BooleanField()
    dossier_type = serializers.CharField(help_text="Hujjat turi: TWO_SIDED_ID_DOSSIER, PASSPORT_DOSSIER, MULTI_PAGE_DOCUMENT")
    total_pages = serializers.IntegerField()
    pages_processed = serializers.IntegerField()
    summary = serializers.CharField()
    merged_profile = serializers.DictField(allow_null=True, required=False)
    pages = serializers.ListField(child=serializers.DictField())
    processing_time_ms = serializers.FloatField()
    error = serializers.CharField(allow_null=True, required=False)


# ── Forensics & Quality Serializers ───────────────────────────────────────────

class ForensicsRequestSerializer(serializers.Serializer):
    """Rasm sifati va raqamli soxtalik tahlili so'rovi."""
    image = serializers.ImageField(
        required=True,
        help_text="Tahlil qilinadigan rasm (JPEG/PNG/WEBP/BMP, maks 10 MB)"
    )

    def validate_image(self, value):
        validate_image_safety(value)
        return value


class ForensicsResponseSerializer(serializers.Serializer):
    """Rasm sifati va raqamli soxtalik tahlili javobi."""
    success = serializers.BooleanField()
    quality = serializers.DictField(help_text="Laplacian xiralik, yaltirash va yorug'lik tahlili")
    tampering = serializers.DictField(help_text="Error Level Analysis (ELA) va Photoshop soxtalik tahlili")
    processing_time_ms = serializers.FloatField()
    error = serializers.CharField(allow_null=True, required=False)


# ── Liveness & Anti-Spoofing Serializers ───────────────────────────────────────

class LivenessChallengeRequestSerializer(serializers.Serializer):
    """Jonlilik tekshiruvi uchun interaktiv sessiya ochish so'rovi."""
    num_challenges = serializers.IntegerField(
        required=False,
        default=2,
        min_value=1,
        max_value=4,
        help_text="Generatsiya qilinadigan harakat savollari soni (standart: 2)"
    )


class LivenessChallengeResponseSerializer(serializers.Serializer):
    """Jonlilik sessiyasi javob sxemasi."""
    success = serializers.BooleanField()
    session_id = serializers.CharField()
    token = serializers.CharField(help_text="HMAC-SHA256 bilan imzolangan xavfsiz sessiya tokeni")
    expires_in_seconds = serializers.IntegerField()
    challenges_count = serializers.IntegerField()
    challenges = serializers.ListField(child=serializers.DictField())


class LivenessVerifyRequestSerializer(serializers.Serializer):
    """Jonlilik kadrlarini tekshirish so'rovi."""
    token = serializers.CharField(
        required=True,
        help_text="Challenge bosqichida olingan HMAC sessiya tokeni"
    )
    frames = serializers.ListField(
        child=serializers.ImageField(),
        min_length=2,
        max_length=6,
        help_text="Kadrlar ketma-ketligi: 1-kadr neytral yuz, keyingilari berilgan topshiriqlar bo'yicha"
    )


class LivenessVerifyResponseSerializer(serializers.Serializer):
    """Jonlilik va Anti-Spoofing tekshiruvi javob sxemasi."""
    success = serializers.BooleanField()
    is_live = serializers.BooleanField(help_text="Foydalanuvchi haqiqiy tirik inson ekanligi tasdiqlandimi")
    liveness_score = serializers.FloatField(help_text="Umumiy jonlilik balli (0.0% - 100.0%)")
    verdict = serializers.CharField(help_text="Xulosa: LIVE_AUTHENTIC, SPOOF_ATTACK_DETECTED, CHALLENGE_FAILED")
    session_id = serializers.CharField(allow_null=True, required=False)
    challenges_verified = serializers.ListField(child=serializers.DictField())
    passive_anti_spoofing = serializers.DictField(allow_null=True, required=False)
    selfie_crop_base64 = serializers.CharField(allow_null=True, required=False)
    processing_time_ms = serializers.FloatField()
    error = serializers.CharField(allow_null=True, required=False)



