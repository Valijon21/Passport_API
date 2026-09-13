"""ocr_api/urls.py — API URL patterns"""
from django.urls import path
from .views import IDCardOCRView, IDCardFullOCRView, GeneralOCRView, FaceMatchView, HealthCheckView, APIInfoView

urlpatterns = [
    # ── OCR Endpoints ─────────────────────────────────────────────────────────
    path('ocr/id/', IDCardOCRView.as_view(), name='ocr-id-card'),
    path('ocr/id-full/', IDCardFullOCRView.as_view(), name='ocr-id-full'),
    path('ocr/general/', GeneralOCRView.as_view(), name='ocr-general'),

    # ── KYC & Biometrics Endpoints ───────────────────────────────────────────
    path('kyc/face-match/', FaceMatchView.as_view(), name='kyc-face-match'),

    # ── System ───────────────────────────────────────────────────────────────
    path('health/', HealthCheckView.as_view(), name='health-check'),
    path('info/', APIInfoView.as_view(), name='api-info'),
]

