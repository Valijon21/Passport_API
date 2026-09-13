"""
tests/test_swagger.py
─────────────────────
Tests for OpenAPI 3.0 schema and Swagger/Redoc endpoints.
"""

import os
import django
from django.test import TestCase, Client
from django.urls import reverse

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')


class TestSwaggerEndpoints(TestCase):
    """Test suite for Swagger UI, Redoc, and OpenAPI Schema views."""

    def setUp(self):
        self.client = Client()

    def test_schema_endpoint(self):
        """GET /api/schema/ should return 200 with OpenAPI yaml/json."""
        resp = self.client.get(reverse('schema'))
        self.assertEqual(resp.status_code, 200)
        content = resp.content.decode('utf-8')
        self.assertTrue('openapi' in content.lower())
        self.assertIn('/api/v1/ocr/id-full/', content)

    def test_swagger_ui_endpoint(self):
        """GET /api/docs/ should return 200 HTML with Swagger UI."""
        resp = self.client.get(reverse('swagger-ui'))
        self.assertEqual(resp.status_code, 200)
        self.assertIn(b'swagger-ui', resp.content.lower())

    def test_redoc_endpoint(self):
        """GET /api/redoc/ should return 200 HTML with Redoc."""
        resp = self.client.get(reverse('redoc'))
        self.assertEqual(resp.status_code, 200)
        self.assertIn(b'redoc', resp.content.lower())

    def test_docs_shortcut(self):
        """GET /docs/ shortcut should return 200."""
        resp = self.client.get(reverse('docs-shortcut'))
        self.assertEqual(resp.status_code, 200)


class TestKYCEndpoint(TestCase):
    """Test suite for KYC Face Match endpoint."""

    def setUp(self):
        self.client = Client()

    def test_kyc_missing_files_400(self):
        """POST /api/v1/kyc/face-match/ without images should return 400 Bad Request."""
        resp = self.client.post('/api/v1/kyc/face-match/', {})
        self.assertEqual(resp.status_code, 400)
        data = resp.json()
        self.assertIn('details', data)
        self.assertIn('document_image', data['details'])
        self.assertIn('selfie_image', data['details'])
