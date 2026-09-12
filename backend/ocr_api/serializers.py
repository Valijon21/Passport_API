"""ocr_api/serializers.py — Request/Response serializers"""
from rest_framework import serializers


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
        # File size check (10MB)
        if value.size > 10 * 1024 * 1024:
            raise serializers.ValidationError(
                "Rasm hajmi 10MB dan oshmasligi kerak."
            )
        # Content type check
        allowed = ['image/jpeg', 'image/png', 'image/bmp', 'image/webp', 'image/tiff']
        content_type = getattr(value, 'content_type', '')
        if content_type and content_type not in allowed:
            raise serializers.ValidationError(
                f"Faqat {', '.join(allowed)} formatlar qabul qilinadi."
            )
        return value


class GeneralOCRRequestSerializer(serializers.Serializer):
    """Validate general text OCR request."""
    image = serializers.ImageField(
        required=True,
        help_text="Har qanday rasm (JPEG/PNG, max 10MB)"
    )

    def validate_image(self, value):
        if value.size > 10 * 1024 * 1024:
            raise serializers.ValidationError("Rasm hajmi 10MB dan oshmasligi kerak.")
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
    confidence = serializers.FloatField()
    processing_time_ms = serializers.FloatField()
    debug = serializers.DictField()
    error = serializers.CharField(allow_null=True)
