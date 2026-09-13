"""
tests/test_liveness.py
──────────────────────
Automated tests for Active & Passive Liveness Verification & Anti-Spoofing.
"""

import os
import cv2
import numpy as np
from django.test import TestCase
from rest_framework.test import APIClient
from rest_framework import status
from django.core.files.uploadedfile import SimpleUploadedFile

from ocr_api.liveness_engine import (
    generate_liveness_challenge,
    verify_challenge_token,
    detect_passive_spoofing,
    verify_challenge_step,
    verify_liveness_session
)

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(CURRENT_DIR, '..', '..'))
PASPORT_IMG_DIR = os.path.join(PROJECT_ROOT, 'pasport_img')


class LivenessEngineTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.sample_path = os.path.join(PASPORT_IMG_DIR, 'card1.png')

    def test_generate_and_verify_token(self):
        ch = generate_liveness_challenge(num_challenges=2, ttl_seconds=60)
        self.assertTrue(ch['success'])
        self.assertIn('token', ch)
        self.assertIn('session_id', ch)
        self.assertEqual(len(ch['challenges']), 2)

        # Verify authentic token
        is_valid, payload, msg = verify_challenge_token(ch['token'])
        self.assertTrue(is_valid)
        self.assertIsNotNone(payload)
        self.assertEqual(payload['sid'], ch['session_id'])

        # Verify tampered token is rejected
        tampered_token = ch['token'] + "tampered"
        bad_valid, bad_payload, bad_msg = verify_challenge_token(tampered_token)
        self.assertFalse(bad_valid)
        self.assertIsNone(bad_payload)

    def test_detect_passive_spoofing_authentic(self):
        if not os.path.exists(self.sample_path):
            self.skipTest("Sample image not found")

        img_bgr = cv2.imread(self.sample_path)
        res = detect_passive_spoofing(img_bgr)
        self.assertIn('is_spoof', res)
        self.assertIn('spoof_score', res)
        self.assertIn('verdict', res)
        self.assertIn('flags', res)

    def test_verify_challenge_step_distance(self):
        # Frame A = small face, Frame B = large face (MOVE_CLOSER)
        h, w = 300, 300
        frame_base = np.full((h, w, 3), 180, dtype=np.uint8)
        frame_action = np.full((h, w, 3), 180, dtype=np.uint8)

        # Draw simulated face rectangles
        cv2.rectangle(frame_base, (80, 80), (220, 220), (220, 190, 160), -1)
        cv2.rectangle(frame_action, (50, 50), (250, 250), (220, 190, 160), -1)

        res = verify_challenge_step('MOVE_CLOSER', frame_base, frame_action)
        self.assertIn('passed', res)
        self.assertIn('confidence', res)

    def test_api_liveness_challenge_endpoint(self):
        resp = self.client.post('/api/v1/kyc/liveness/challenge/', {'num_challenges': 2}, format='json')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        data = resp.json()
        self.assertTrue(data['success'])
        self.assertIn('token', data)
        self.assertEqual(len(data['challenges']), 2)

    def test_api_liveness_verify_endpoint_validation(self):
        # Empty request rejected with 400
        resp = self.client.post('/api/v1/kyc/liveness/verify/', {}, format='multipart')
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
