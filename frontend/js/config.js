/**
 * config.js — Application Configuration and Shared State
 */
'use strict';

//  CONFIG
// ══════════════════════════════════════════════════════════════
const CONFIG = {
  API_BASE: (() => {
    if (typeof window !== 'undefined' && window.location.hostname) {
      const host = window.location.hostname;
      if (window.location.port === '8000') {
        return `${window.location.origin}/api/v1`;
      }
      return `http://${host}:8000/api/v1`;
    }
    return 'http://127.0.0.1:8000/api/v1';
  })(),
  ENDPOINTS: {
    ID_CARD:            '/ocr/id/',
    ID_FULL:            '/ocr/id-full/',
    DOSSIER_PDF:        '/ocr/dossier-pdf/',
    FORENSICS:          '/ocr/forensics/',
    GENERAL:            '/ocr/general/',
    FACE_MATCH:         '/kyc/face-match/',
    LIVENESS_CHALLENGE: '/kyc/liveness/challenge/',
    LIVENESS_VERIFY:    '/kyc/liveness/verify/',
    HEALTH:             '/health/',
    INFO:               '/info/',
  },
};

// ══════════════════════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════════════════════
const state = {
  file: null,
  frontFile: null,
  backFile: null,
  pdfFile: null,
  appMode: 'single',     // 'single' | 'double' | 'pdf'
  selfieFile: null,
  lastResult: null,
  lastResultType: null,  // 'id' | 'general' | 'id_full' | 'pdf_dossier'
  livenessSession: null,
  livenessFrames: [],
  docCaptureTarget: 'single', // 'single' | 'front' | 'back'
  docCaptureMode: 'manual',   // 'manual' (default, 100% user control) | 'auto'
  docStream: null,
  docAnimFrameId: null,
  docStabilityCounter: 0,
  lastDocFrameData: null,
};

