"""ocr_api/urls.py — API URL patterns"""
from django.urls import path
from .views import IDCardOCRView, GeneralOCRView, HealthCheckView, APIInfoView

urlpatterns = [
    # ── OCR Endpoints ─────────────────────────────────────────────────────────
    path('ocr/id/', IDCardOCRView.as_view(), name='ocr-id-card'),
    path('ocr/general/', GeneralOCRView.as_view(), name='ocr-general'),

    # ── System ───────────────────────────────────────────────────────────────
    path('health/', HealthCheckView.as_view(), name='health-check'),
    path('info/', APIInfoView.as_view(), name='api-info'),
]
