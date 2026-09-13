"""
tests/test_forensics.py
───────────────────────
Automated tests for Image Quality Assessment & Tampering Forensics.
"""

import os
import cv2
import numpy as np
from django.test import TestCase
from rest_framework.test import APIClient
from rest_framework import status
from django.core.files.uploadedfile import SimpleUploadedFile

from ocr_api.forensics_engine import (
    assess_image_quality,
    detect_digital_tampering,
    run_full_forensics
)

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(CURRENT_DIR, '..', '..'))
PASPORT_IMG_DIR = os.path.join(PROJECT_ROOT, 'pasport_img')


class ForensicsEngineTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.sample_path = os.path.join(PASPORT_IMG_DIR, 'card1.png')

    def test_assess_image_quality_authentic(self):
        if not os.path.exists(self.sample_path):
            self.skipTest("Sample image not found")

        img_bgr = cv2.imread(self.sample_path)
        res = assess_image_quality(img_bgr)

        self.assertIn('overall_quality_score', res)
        self.assertIn('blur_score', res)
        self.assertIn('has_glare', res)
        self.assertIn('brightness_level', res)
        self.assertGreaterEqual(res['overall_quality_score'], 0.0)
        self.assertLessEqual(res['overall_quality_score'], 100.0)
        self.assertIsInstance(res['recommendations'], list)

    def test_assess_image_quality_blurry(self):
        # Create an artificially blurred image
        clean_img = np.full((300, 400, 3), 128, dtype=np.uint8)
        # Heavy Gaussian blur gives very low Laplacian variance (< 10)
        blurry_img = cv2.GaussianBlur(clean_img, (51, 51), 0)
        res = assess_image_quality(blurry_img)

        self.assertTrue(res['is_blurry'])
        self.assertLess(res['blur_score'], 95.0)

    def test_detect_digital_tampering(self):
        if not os.path.exists(self.sample_path):
            self.skipTest("Sample image not found")

        img_bgr = cv2.imread(self.sample_path)
        res = detect_digital_tampering(img_bgr)

        self.assertIn('tampering_detected', res)
        self.assertIn('tampering_risk_score', res)
        self.assertIn('risk_level', res)
        self.assertIn('ela_heatmap_base64', res)
        self.assertTrue(res['ela_heatmap_base64'].startswith('data:image/jpeg;base64,'))
        self.assertIn(res['risk_level'], ('LOW', 'MEDIUM', 'HIGH'))

    def test_run_full_forensics_bytes(self):
        if not os.path.exists(self.sample_path):
            self.skipTest("Sample image not found")

        with open(self.sample_path, 'rb') as f:
            data = f.read()

        res = run_full_forensics(data)
        self.assertTrue(res['success'])
        self.assertIn('quality', res)
        self.assertIn('tampering', res)

    def test_api_forensics_endpoint(self):
        if not os.path.exists(self.sample_path):
            self.skipTest("Sample image not found")

        with open(self.sample_path, 'rb') as f:
            uploaded = SimpleUploadedFile('card1.png', f.read(), content_type='image/png')

        resp = self.client.post('/api/v1/ocr/forensics/', {'image': uploaded}, format='multipart')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        data = resp.json()
        self.assertTrue(data['success'])
        self.assertIn('quality', data)
        self.assertIn('tampering', data)
        self.assertIn('processing_time_ms', data)
