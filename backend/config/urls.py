"""config/urls.py — Main URL Configuration"""
from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from django.views.static import serve
from pathlib import Path
from drf_spectacular.views import SpectacularAPIView, SpectacularRedocView, SpectacularSwaggerView

FRONTEND_DIR = settings.BASE_DIR.parent / 'frontend'

urlpatterns = [
    # ── Frontend Web UI ───────────────────────────────────────────────────────
    path('', serve, {'document_root': FRONTEND_DIR, 'path': 'index.html'}, name='home'),
    path('style.css', serve, {'document_root': FRONTEND_DIR, 'path': 'style.css'}, name='style'),
    path('app.js', serve, {'document_root': FRONTEND_DIR, 'path': 'app.js'}, name='app'),
    path('js/<path:path>', serve, {'document_root': FRONTEND_DIR / 'js'}, name='frontend-js'),

    # ── API & Admin ───────────────────────────────────────────────────────────
    path('admin/', admin.site.urls),
    path('api/v1/', include('ocr_api.urls')),

    # ── OpenAPI 3.0 & Swagger UI ──────────────────────────────────────────────
    path('api/schema/', SpectacularAPIView.as_view(), name='schema'),
    path('api/docs/', SpectacularSwaggerView.as_view(url_name='schema'), name='swagger-ui'),
    path('api/redoc/', SpectacularRedocView.as_view(url_name='schema'), name='redoc'),
    path('docs/', SpectacularSwaggerView.as_view(url_name='schema'), name='docs-shortcut'),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
