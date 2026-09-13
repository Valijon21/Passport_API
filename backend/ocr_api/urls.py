"""ocr_api/urls.py — API URL patterns"""
from django.urls import path
from .views import (
    IDCardOCRView,
    IDCardFullOCRView,
    GeneralOCRView,
    DossierPDFOCRView,
    ImageForensicsView,
    FaceMatchView,
    LivenessChallengeView,
    LivenessVerifyView,
    HealthCheckView,
    APIInfoView,
)

urlpatterns = [
    # ── OCR & Document Endpoints ──────────────────────────────────────────────
    path('ocr/id/', IDCardOCRView.as_view(), name='ocr-id-card'),
    path('ocr/id-full/', IDCardFullOCRView.as_view(), name='ocr-id-full'),
    path('ocr/dossier-pdf/', DossierPDFOCRView.as_view(), name='ocr-dossier-pdf'),
    path('ocr/forensics/', ImageForensicsView.as_view(), name='ocr-forensics'),
    path('ocr/general/', GeneralOCRView.as_view(), name='ocr-general'),

    # ── KYC, Biometrics & Anti-Spoofing Endpoints ─────────────────────────────
    path('kyc/face-match/', FaceMatchView.as_view(), name='kyc-face-match'),
    path('kyc/liveness/challenge/', LivenessChallengeView.as_view(), name='kyc-liveness-challenge'),
    path('kyc/liveness/verify/', LivenessVerifyView.as_view(), name='kyc-liveness-verify'),

    # ── System ────────────────────────────────────────────────────────────────
    path('health/', HealthCheckView.as_view(), name='health-check'),
    path('info/', APIInfoView.as_view(), name='api-info'),
]

