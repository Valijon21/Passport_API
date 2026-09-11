"""config/urls.py — Main URL Configuration"""
from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from django.views.static import serve
from pathlib import Path

FRONTEND_DIR = settings.BASE_DIR.parent / 'frontend'

urlpatterns = [
    # ── Frontend Web UI ───────────────────────────────────────────────────────
    path('', serve, {'document_root': FRONTEND_DIR, 'path': 'index.html'}, name='home'),
    path('style.css', serve, {'document_root': FRONTEND_DIR, 'path': 'style.css'}, name='style'),
    path('app.js', serve, {'document_root': FRONTEND_DIR, 'path': 'app.js'}, name='app'),

    # ── API & Admin ───────────────────────────────────────────────────────────
    path('admin/', admin.site.urls),
    path('api/v1/', include('ocr_api.urls')),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
