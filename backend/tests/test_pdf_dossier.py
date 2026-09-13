"""
tests/test_pdf_dossier.py
─────────────────────────
Automated tests for Multi-Page Scanned PDF Dossier OCR & Smart Merge.
"""

import os
import io
from PIL import Image
from django.test import TestCase
from rest_framework.test import APIClient
from rest_framework import status
from django.core.files.uploadedfile import SimpleUploadedFile

from ocr_api.pdf_engine import process_dossier_pdf, classify_page_type

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(CURRENT_DIR, '..', '..'))
PASPORT_IMG_DIR = os.path.join(PROJECT_ROOT, 'pasport_img')


class PDFDossierTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.front_path = os.path.join(PASPORT_IMG_DIR, 'card4.jpg')
        self.back_path = os.path.join(PASPORT_IMG_DIR, 'card5.jpg')

    def test_process_empty_pdf(self):
        res = process_dossier_pdf(b'')
        self.assertFalse(res['success'])
        self.assertEqual(res['total_pages'], 0)

    def test_process_synthetic_2page_id_dossier(self):
        if not os.path.exists(self.front_path) or not os.path.exists(self.back_path):
            self.skipTest("Sample card images not found")

        # Create multi-page PDF in memory: page 1 = front, page 2 = back
        im_front = Image.open(self.front_path)
        im_back = Image.open(self.back_path)

        pdf_buf = io.BytesIO()
        im_front.save(pdf_buf, format='PDF', save_all=True, append_images=[im_back])
        pdf_bytes = pdf_buf.getvalue()

        res = process_dossier_pdf(pdf_bytes, max_pages=5)
        self.assertTrue(res['success'])
        self.assertEqual(res['total_pages'], 2)
        self.assertEqual(res['pages_processed'], 2)
        self.assertEqual(res['dossier_type'], 'TWO_SIDED_ID_DOSSIER')
        self.assertIsNotNone(res['merged_profile'])
        self.assertIn('citizen_profile', res['merged_profile'])
        self.assertIn('validation', res['merged_profile'])

    def test_api_dossier_pdf_endpoint(self):
        if not os.path.exists(self.front_path) or not os.path.exists(self.back_path):
            self.skipTest("Sample card images not found")

        im_front = Image.open(self.front_path)
        im_back = Image.open(self.back_path)

        pdf_buf = io.BytesIO()
        im_front.save(pdf_buf, format='PDF', save_all=True, append_images=[im_back])
        pdf_bytes = pdf_buf.getvalue()

        uploaded = SimpleUploadedFile('dossier_app.pdf', pdf_bytes, content_type='application/pdf')
        resp = self.client.post('/api/v1/ocr/dossier-pdf/', {'file': uploaded, 'max_pages': 5}, format='multipart')

        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        data = resp.json()
        self.assertTrue(data['success'])
        self.assertEqual(data['total_pages'], 2)
        self.assertIn('merged_profile', data)
        self.assertIn('pages', data)
