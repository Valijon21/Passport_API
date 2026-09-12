"""
tests/test_face_engine.py
─────────────────────────
Unit tests for Face Crop & 1:1 KYC Face Match engine.
"""

import unittest
import numpy as np
import cv2
from ocr_api.face_engine import (
    detect_and_crop_face,
    compare_faces,
    verify_kyc_selfie,
    _extract_face_descriptor
)


class TestFaceEngine(unittest.TestCase):
    """Test suite for Face Extraction & KYC Matching."""

    def setUp(self):
        # Create a synthetic face-like image with geometric features
        self.synthetic_face = np.ones((200, 200, 3), dtype=np.uint8) * 180
        # Draw eyes, nose, mouth
        cv2.circle(self.synthetic_face, (70, 70), 15, (50, 50, 50), -1)
        cv2.circle(self.synthetic_face, (130, 70), 15, (50, 50, 50), -1)
        cv2.ellipse(self.synthetic_face, (100, 140), (40, 20), 0, 0, 180, (50, 50, 50), 3)

        # Blank image (no face)
        self.blank_img = np.zeros((200, 200, 3), dtype=np.uint8)

    def test_blank_image_no_face(self):
        """Blank image should gracefully return detected=False without crashing."""
        res = detect_and_crop_face(self.blank_img)
        self.assertFalse(res['detected'])
        self.assertIsNone(res['box'])
        self.assertIsNone(res['image_base64'])

    def test_identical_face_comparison(self):
        """Comparing identical face with itself must yield 100% similarity and VERIFIED_MATCH."""
        res = compare_faces(self.synthetic_face, self.synthetic_face)
        self.assertTrue(res['success'])
        self.assertTrue(res['match'])
        self.assertGreaterEqual(res['similarity_percentage'], 95.0)
        self.assertEqual(res['verdict'], 'VERIFIED_MATCH')

    def test_different_face_comparison(self):
        """Comparing face with a different face with distinct features should yield match=False."""
        diff_face = np.ones((200, 200, 3), dtype=np.uint8) * 100
        cv2.circle(diff_face, (50, 110), 22, (20, 20, 20), -1)
        cv2.circle(diff_face, (150, 110), 22, (20, 20, 20), -1)
        cv2.line(diff_face, (80, 160), (120, 160), (20, 20, 20), 5)
        res = compare_faces(self.synthetic_face, diff_face, threshold=72.0)
        self.assertTrue(res['success'])
        self.assertFalse(res['match'])
        self.assertIn(res['verdict'], ['MISMATCH', 'UNCERTAIN'])

    def test_descriptor_normalization(self):
        """Feature descriptors must be unit-normalized L2 vectors."""
        desc = _extract_face_descriptor(self.synthetic_face)
        norm = np.linalg.norm(desc)
        self.assertAlmostEqual(norm, 1.0, places=2)

    def test_verify_kyc_selfie_invalid_bytes(self):
        """Invalid byte stream should return clean error dict without throwing exception."""
        res = verify_kyc_selfie(b'not an image', b'not an image')
        self.assertFalse(res['success'])
        self.assertFalse(res['match'])
        self.assertIn('error', res)


if __name__ == '__main__':
    unittest.main()
