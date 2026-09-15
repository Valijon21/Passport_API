/**
 * kyc-modal.js — KYC 1:1 Biometric Face Match Modal and Live Selfie Tracker
 */
'use strict';

// ── KYC State & Live Camera ──────────────────────────────────
let kycStream = null;
let kycFacingMode = 'user'; // 'user' (front camera) or 'environment' (back camera)
let kycCurrentMode = 'camera'; // 'camera' | 'upload'
let isCameraStarting = false;
let currentSnapshotUrl = null;

function resetKYCState() {
  stopKYCCamera();
  state.selfieFile = null;

  // Revoke snapshot object URL to prevent memory leaks
  if (currentSnapshotUrl) {
    try { URL.revokeObjectURL(currentSnapshotUrl); } catch (e) {}
    currentSnapshotUrl = null;
  }

  // Reset Live Camera Snapshot preview
  const snapOverlay = document.getElementById('snapshotOverlay');
  if (snapOverlay) snapOverlay.style.display = 'none';
  const snapImg = document.getElementById('kycSnapshotImg');
  if (snapImg) snapImg.src = '';

  // Reset File Upload preview
  const kycSelfieImg = document.getElementById('kycSelfieImg');
  if (kycSelfieImg) {
    kycSelfieImg.src = '';
    kycSelfieImg.style.display = 'none';
  }
  const uploadPrompt = document.getElementById('selfieUploadPrompt');
  if (uploadPrompt) uploadPrompt.style.display = 'block';
  const selfieInput = document.getElementById('selfieInput');
  if (selfieInput) selfieInput.value = '';

  // Reset KYC Result Box & Banner
  const resBox = document.getElementById('kycResultBox');
  if (resBox) resBox.style.display = 'none';
  const banner = document.getElementById('kycBanner');
  if (banner) {
    banner.className = 'kyc-result-banner';
    banner.innerHTML = '';
  }
  const details = document.getElementById('kycDetails');
  if (details) details.innerHTML = '';

  // Reset Live Camera View controls
  const guide = document.getElementById('cameraGuide');
  if (guide) guide.style.display = 'none';
  const topBar = document.getElementById('cameraTopBar');
  if (topBar) topBar.style.display = 'none';
  const shutterBar = document.getElementById('cameraShutterBar');
  if (shutterBar) shutterBar.style.display = 'none';
  const video = document.getElementById('kycVideo');
  if (video) video.style.display = 'none';
  const prompt = document.getElementById('cameraStartPrompt');
  if (prompt) prompt.style.display = 'none';

  // Reset Status
  const status = document.getElementById('kycSelfieStatus');
  if (status) {
    status.textContent = 'Kamera kutilmoqda...';
    status.className = 'kyc-photo-status text-muted';
  }

  // Reset Run Button
  const btnRun = document.getElementById('btnRunKYC');
  if (btnRun) {
    btnRun.disabled = true;
    btnRun.classList.remove('btn-pulse');
    btnRun.textContent = '⚡ Solishtirish (Face Match)';
  }
}

function openKYCModal() {
  const modal = document.getElementById('kycModal');
  if (!modal) return;
  modal.style.display = 'flex';
  log('KYC Selfie Match paneli ochildi', LEVELS.INFO);

  // Always hide previous match results when opening modal for fresh comparison
  const resBox = document.getElementById('kycResultBox');
  if (resBox) resBox.style.display = 'none';

  // Auto-start camera if in camera mode and no selfie taken yet
  if (kycCurrentMode === 'camera' && !state.selfieFile && !kycStream) {
    startKYCCamera();
  }
}

function closeKYCModal() {
  stopKYCCamera();
  const modal = document.getElementById('kycModal');
  if (modal) modal.style.display = 'none';
}

function switchKYCMode(mode) {
  kycCurrentMode = mode;
  const btnCam = document.getElementById('btnModeCamera');
  const btnUp = document.getElementById('btnModeUpload');
  const camView = document.getElementById('kycCameraView');
  const upView = document.getElementById('kycUploadView');

  if (mode === 'camera') {
    if (btnCam) btnCam.classList.add('active');
    if (btnUp) btnUp.classList.remove('active');
    if (camView) camView.style.display = 'flex';
    if (upView) upView.style.display = 'none';
    if (!state.selfieFile) {
      startKYCCamera();
    }
  } else {
    if (btnUp) btnUp.classList.add('active');
    if (btnCam) btnCam.classList.remove('active');
    if (camView) camView.style.display = 'none';
    if (upView) upView.style.display = 'flex';
    stopKYCCamera();
  }
}

// ── Real-Time Face Alignment Tracker (KYC Camera) ─────────────
let faceTrackerId = null;
let lastFaceQualityState = {
  hasFace: false,
  isCentered: false,
  isFullFace: false,
  isTooClose: false,
  isTooFar: false,
  steadyFrames: 0
};
let offscreenTrackerCanvas = null;
let offscreenTrackerCtx = null;
let browserFaceDetector = null;

try {
  if (typeof window.FaceDetector === 'function') {
    browserFaceDetector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
  }
} catch (e) {
  browserFaceDetector = null;
}

function startFaceGuideTracker() {
  stopFaceGuideTracker();

  if (!offscreenTrackerCanvas) {
    offscreenTrackerCanvas = document.createElement('canvas');
    offscreenTrackerCanvas.width = 160;
    offscreenTrackerCanvas.height = 120;
    offscreenTrackerCtx = offscreenTrackerCanvas.getContext('2d', { willReadFrequently: true, alpha: false });
  }

  const video = document.getElementById('kycVideo');
  if (!video) return;

  const checkIntervalMs = 90;
  let isChecking = false;

  faceTrackerId = setInterval(async () => {
    if (isChecking || !video || video.paused || video.ended || !video.videoWidth) return;
    isChecking = true;

    try {
      offscreenTrackerCtx.drawImage(video, 0, 0, 160, 120);

      let hasFace = false;
      let isCentered = false;
      let isFullFace = false;
      let isTooClose = false;
      let isTooFar = false;

      // Method 1: Hardware-accelerated browser FaceDetector (Chromium/Android)
      if (browserFaceDetector) {
        try {
          const faces = await browserFaceDetector.detect(offscreenTrackerCanvas);
          if (faces && faces.length > 0) {
            hasFace = true;
            const b = faces[0].boundingBox;
            const cx = (b.x + b.width / 2) / 160;
            const cy = (b.y + b.height / 2) / 120;
            const wRatio = b.width / 160;
            const isClipped = (b.x <= 2 || b.y <= 2 || (b.x + b.width) >= 158 || (b.y + b.height) >= 118);

            isFullFace = !isClipped;
            isCentered = Math.abs(cx - 0.50) < 0.15 && Math.abs(cy - 0.45) < 0.16;
            isTooFar = wRatio < 0.20;
            isTooClose = wRatio > 0.65;
          }
        } catch (detErr) {
          // Fall back to canvas chrominance
        }
      }

      // Method 2: High-speed Canvas Skin-Chrominance & Feature Contrast Fallback
      if (!hasFace) {
        const imgData = offscreenTrackerCtx.getImageData(0, 0, 160, 120);
        const d = imgData.data;

        let ovalSkinCount = 0;
        let leftSkinCount = 0;
        let rightSkinCount = 0;
        let borderSkinCount = 0;
        let lumSum = 0;
        let lumSqSum = 0;
        let sampleCount = 0;

        for (let y = 0; y < 120; y += 2) {
          for (let x = 0; x < 160; x += 2) {
            const idx = (y * 160 + x) * 4;
            const r = d[idx];
            const g = d[idx + 1];
            const b = d[idx + 2];

            // Skin chrominance rule (daylight human skin range)
            const isSkin = (r > 65 && g > 40 && b > 25 && r > g && r > b && (r - g) > 12 && (r - b) > 15);

            // Border pixels (to detect severe boundary clipping)
            const isBorder = (x <= 4 || x >= 156 || y <= 4 || y >= 116);
            if (isBorder && isSkin) {
              borderSkinCount++;
            }

            // Oval zone: center region
            const inOval = (x >= 40 && x <= 120 && y >= 20 && y <= 100);
            if (inOval) {
              sampleCount++;
              const lum = 0.299 * r + 0.587 * g + 0.114 * b;
              lumSum += lum;
              lumSqSum += lum * lum;

              if (isSkin) {
                ovalSkinCount++;
                if (x < 80) leftSkinCount++;
                else rightSkinCount++;
              }
            }
          }
        }

        const skinDensity = sampleCount > 0 ? (ovalSkinCount / sampleCount) : 0;
        const meanLum = sampleCount > 0 ? (lumSum / sampleCount) : 0;
        const variance = sampleCount > 0 ? (lumSqSum / sampleCount - meanLum * meanLum) : 0;
        const stdDev = Math.sqrt(Math.max(0, variance));

        if (skinDensity > 0.26 && stdDev > 15.0) {
          hasFace = true;
          const balance = (leftSkinCount + 1) / (rightSkinCount + 1);
          isCentered = balance >= 0.50 && balance <= 1.90;
          isTooClose = borderSkinCount > 18 || skinDensity > 0.85;
          isTooFar = skinDensity < 0.30;
          isFullFace = !isTooClose && borderSkinCount <= 12;
        }
      }

      lastFaceQualityState.hasFace = hasFace;
      lastFaceQualityState.isCentered = isCentered;
      lastFaceQualityState.isFullFace = isFullFace;
      lastFaceQualityState.isTooClose = isTooClose;
      lastFaceQualityState.isTooFar = isTooFar;

      updateFaceGuideUI(lastFaceQualityState);

    } catch (loopErr) {
      console.warn('Face guide tracker loop error:', loopErr);
    } finally {
      isChecking = false;
    }
  }, checkIntervalMs);
}

function stopFaceGuideTracker() {
  if (faceTrackerId) {
    clearInterval(faceTrackerId);
    faceTrackerId = null;
  }
}

function updateFaceGuideUI(qState) {
  const oval = document.getElementById('kycOvalGuide');
  const statusText = document.getElementById('ovalStatusText');
  const statusDot = document.querySelector('.oval-status-dot');
  const caption = document.getElementById('kycGuideCaption');
  const hint = document.getElementById('kycShutterHint');
  const btnShutter = document.getElementById('btnShutter');

  if (!oval || !statusText) return;

  if (!qState.hasFace) {
    qState.steadyFrames = 0;
    oval.className = 'oval-guide no-face';
    statusText.textContent = 'Yuz qidirilmoqda...';
    if (statusDot) statusDot.className = 'oval-status-dot';
    if (caption) caption.textContent = "Yuzingizni doira markaziga to'g'rilang";
    if (hint) {
      hint.textContent = '⚠️ Yuz aniqlanmadi';
      hint.className = 'shutter-hint hint-warn';
    }
    if (btnShutter) btnShutter.classList.remove('shutter-ready');
    return;
  }

  // Face is present, check alignment and boundaries
  if (!qState.isFullFace || qState.isTooClose) {
    qState.steadyFrames = 0;
    oval.className = 'oval-guide adjust-face';
    statusText.textContent = "To'liq tushmadi";
    if (statusDot) statusDot.className = 'oval-status-dot dot-adjust';
    if (caption) caption.textContent = "Biroz uzoqlashing (yuzingiz kesilmasin)";
    if (hint) {
      hint.textContent = "⚠️ Yuz to'liq tushmadi (kesilgan)";
      hint.className = 'shutter-hint hint-warn';
    }
    if (btnShutter) btnShutter.classList.remove('shutter-ready');
  } else if (qState.isTooFar) {
    qState.steadyFrames = 0;
    oval.className = 'oval-guide adjust-face';
    statusText.textContent = 'Yaqinroq keling';
    if (statusDot) statusDot.className = 'oval-status-dot dot-adjust';
    if (caption) caption.textContent = 'Kameraga biroz yaqinroq keling';
    if (hint) {
      hint.textContent = '⚠️ Yuz juda uzoqda';
      hint.className = 'shutter-hint hint-warn';
    }
    if (btnShutter) btnShutter.classList.remove('shutter-ready');
  } else if (!qState.isCentered) {
    qState.steadyFrames = 0;
    oval.className = 'oval-guide adjust-face';
    statusText.textContent = 'Markazga suring';
    if (statusDot) statusDot.className = 'oval-status-dot dot-adjust';
    if (caption) caption.textContent = "Yuzingizni doira markaziga to'g'rilang";
    if (hint) {
      hint.textContent = '⚠️ Yuz markazda emas';
      hint.className = 'shutter-hint hint-warn';
    }
    if (btnShutter) btnShutter.classList.remove('shutter-ready');
  } else {
    // Face is centered and fully in frame!
    qState.steadyFrames = (qState.steadyFrames || 0) + 1;
    oval.className = 'oval-guide face-ready';
    statusText.textContent = '✓ Yuz aniqlandi';
    if (statusDot) statusDot.className = 'oval-status-dot dot-ready';
    if (caption) caption.textContent = '✓ Ajoyib! Qimirlamang';
    if (hint) {
      hint.textContent = '✓ Suratga olishga tayyor';
      hint.className = 'shutter-hint hint-ready';
    }
    if (btnShutter) btnShutter.classList.add('shutter-ready');
  }
}

async function startKYCCamera() {
  if (isCameraStarting) return;
  isCameraStarting = true;

  const video = document.getElementById('kycVideo');
  const prompt = document.getElementById('cameraStartPrompt');
  const guide = document.getElementById('cameraGuide');
  const topBar = document.getElementById('cameraTopBar');
  const shutterBar = document.getElementById('cameraShutterBar');
  const loader = document.getElementById('cameraLoader');
  const snapOverlay = document.getElementById('snapshotOverlay');
  const status = document.getElementById('kycSelfieStatus');
  const facingLabelEl = document.getElementById('camFacingLabel');

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showError('Kamera qo\'llab-quvvatlanmaydi', 'Brauzeringiz kamerani qo\'llab-quvvatlamaydi. "Fayl" rejimidan foydalaning.');
    switchKYCMode('upload');
    isCameraStarting = false;
    return;
  }

  try {
    stopKYCCamera();

    if (prompt) prompt.style.display = 'none';
    if (snapOverlay) snapOverlay.style.display = 'none';
    if (loader) loader.style.display = 'flex';
    if (status) {
      status.textContent = 'Kamera ulanmoqda...';
      status.className = 'kyc-photo-status text-muted';
    }

    const facingText = kycFacingMode === 'user' ? 'Old kamera' : 'Orqa kamera';
    if (facingLabelEl) facingLabelEl.textContent = facingText;

    // Stream constraints: optimized for smooth 30-60 FPS without driver/USB bandwidth stalls
    let stream = null;
    const constraints = {
      video: {
        facingMode: kycFacingMode ? { ideal: kycFacingMode } : 'user',
        width: { ideal: 640, max: 1280 },
        height: { ideal: 480, max: 720 },
        frameRate: { ideal: 30, max: 60 }
      },
      audio: false
    };

    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (firstErr) {
      console.warn('Optimized camera constraints failed, attempting fallback {video: true}:', firstErr);
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }

    kycStream = stream;

    if (video) {
      video.srcObject = stream;
      video.playsInline = true;
      video.style.display = 'block';

      // Wait for camera to actually stream frames before rendering UI to avoid black frame
      video.onloadeddata = async () => {
        try {
          await video.play();
        } catch (playErr) {
          console.warn('Autoplay handled:', playErr);
        }
        if (loader) loader.style.display = 'none';
        if (guide) guide.style.display = 'flex';
        if (topBar) topBar.style.display = 'flex';
        if (shutterBar) shutterBar.style.display = 'flex';
        const btnShutter = document.getElementById('btnShutter');
        if (btnShutter) btnShutter.disabled = false;
        const btnLiveness = document.getElementById('btnTriggerLiveness');
        if (btnLiveness) btnLiveness.style.display = 'inline-flex';
        if (status) {
          status.textContent = `● Jonli efir (${facingText})`;
          status.className = 'kyc-photo-status text-ok';
        }
        // Start Real-Time Face Alignment Tracking Loop
        startFaceGuideTracker();
      };

      // Direct play call as well
      try {
        await video.play();
      } catch (e) {}
    }

    log(`Jonli kamera ishga tushirildi (${facingText})`, LEVELS.OK);

  } catch (err) {
    console.error('Camera init error:', err);
    let msg = 'Kameradan foydalanish imkoni bo\'lmadi.';
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      msg = 'Kameraga ruxsat berilmadi. Brauzer manzil qatorida (URL yonida) kamera belgisini bosib ruxsat bering yoki "Fayl" rejimidan foydalaning.';
    } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
      msg = 'Qurilmada kamera topilmadi. Fayl yuklash rejimidan foydalaning.';
    } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
      msg = 'Kamera boshqa dastur tomonidan band qilingan. Iltimos, boshqa ilovalarni yoping.';
    }

    if (loader) loader.style.display = 'none';
    if (status) {
      status.textContent = 'Kamera ulanmadi';
      status.className = 'kyc-photo-status text-fail';
    }
    showError('Kamera xatosi', msg);
    switchKYCMode('upload');
  } finally {
    isCameraStarting = false;
  }
}

function stopKYCCamera() {
  stopFaceGuideTracker();
  if (kycStream) {
    kycStream.getTracks().forEach(track => {
      try { track.stop(); } catch (e) {}
    });
    kycStream = null;
  }
  const video = document.getElementById('kycVideo');
  if (video) {
    video.srcObject = null;
  }
  const btnLiveness = document.getElementById('btnTriggerLiveness');
  if (btnLiveness) btnLiveness.style.display = 'none';
}

function captureKYCSnapshot() {
  const video = document.getElementById('kycVideo');
  const canvas = document.getElementById('kycCanvas');
  const snapImg = document.getElementById('kycSnapshotImg');
  const snapOverlay = document.getElementById('snapshotOverlay');
  const flash = document.getElementById('cameraFlash');
  const guide = document.getElementById('cameraGuide');
  const topBar = document.getElementById('cameraTopBar');
  const shutterBar = document.getElementById('cameraShutterBar');
  const btnRun = document.getElementById('btnRunKYC');
  const status = document.getElementById('kycSelfieStatus');
  const btnShutter = document.getElementById('btnShutter');

  if (!video || !video.videoWidth || video.videoWidth === 0) {
    showError('Kamera tayyor emas', 'Kamera hali to\'liq yuklanmadi. 1 soniya kuting yoki qaytadan yoqing.');
    return;
  }

  // Pre-Capture Face Quality Gate: Ensure real face is present and fully visible
  if (video && video.videoWidth > 0) {
    if (!lastFaceQualityState.hasFace) {
      showError("Yuz aniqlanmadi", "Kamerada yuz aniqlanmadi. Iltimos, yuzingizni doira markaziga to'g'ri tutib suratga oling.");
      if (btnShutter) btnShutter.disabled = false;
      return;
    }
    if (!lastFaceQualityState.isFullFace || lastFaceQualityState.isTooClose) {
      showError("Yuz to'liq tushmadi", "Yuzingiz kameraga to'liq tushmadi (chekkalari kesilib qolgan yoki juda yaqin). Iltimos, biroz orqaroq surilib qaytadan oling.");
      if (btnShutter) btnShutter.disabled = false;
      return;
    }
  }

  // Prevent multiple rapid clicks during capture
  if (btnShutter) btnShutter.disabled = true;

  // 1. Instant tactile & flash animation (smooth 60 FPS feedback)
  if (flash) {
    flash.classList.add('flash-active');
    requestAnimationFrame(() => {
      setTimeout(() => flash.classList.remove('flash-active'), 120);
    });
  }
  if (navigator.vibrate) {
    try { navigator.vibrate(40); } catch (e) {}
  }

  // 2. High-performance resolution scaling (cap to 800px max dimension)
  // Eliminates heavy 1080p/4K main thread blocking (< 1ms drawing latency)
  const maxDim = 800;
  let vw = video.videoWidth || 640;
  let vh = video.videoHeight || 480;
  if (vw > maxDim || vh > maxDim) {
    if (vw > vh) {
      vh = Math.round((vh * maxDim) / vw);
      vw = maxDim;
    } else {
      vw = Math.round((vw * maxDim) / vh);
      vh = maxDim;
    }
  }

  canvas.width = vw;
  canvas.height = vh;
  const ctx = canvas.getContext('2d', { alpha: false });

  // 3. Render video frame to canvas with mirror correction if user-facing
  if (kycFacingMode === 'user') {
    ctx.save();
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    ctx.restore();
  } else {
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  }

  // 4. Non-blocking zero-copy snapshot preview via toBlob + ObjectURL (NO toDataURL!)
  canvas.toBlob((blob) => {
    if (!blob) {
      if (btnShutter) btnShutter.disabled = false;
      return;
    }

    stopFaceGuideTracker();

    // Clean up previous blob URL to prevent memory leaks
    if (currentSnapshotUrl) {
      try { URL.revokeObjectURL(currentSnapshotUrl); } catch (e) {}
      currentSnapshotUrl = null;
    }

    currentSnapshotUrl = URL.createObjectURL(blob);
    if (snapImg) snapImg.src = currentSnapshotUrl;
    if (snapOverlay) snapOverlay.style.display = 'flex';

    // Hide live camera overlay elements
    if (guide) guide.style.display = 'none';
    if (topBar) topBar.style.display = 'none';
    if (shutterBar) shutterBar.style.display = 'none';
    if (video) video.style.display = 'none';

    // Store file in state for KYC Face Match API
    state.selfieFile = new File([blob], 'live_selfie.jpg', { type: 'image/jpeg' });

    if (btnRun) {
      btnRun.disabled = false;
      btnRun.classList.add('btn-pulse');
    }
    const snapBadge = document.getElementById('snapBadgeText');
    if (snapBadge) snapBadge.textContent = "✓ To'liq biometrik yuz olindi";
    if (status) {
      status.textContent = '✓ Jonli biometrik selfie olindi';
      status.className = 'kyc-photo-status text-ok';
    }
    if (btnShutter) btnShutter.disabled = false;
    log('Jonli biometrik selfie muvaffaqiyatli olindi (Zero-Latency Snapshot)', LEVELS.OK);

    // Stop camera device asynchronously to avoid blocking UI frame render
    setTimeout(() => stopKYCCamera(), 60);
  }, 'image/jpeg', 0.88);
}


function retakeKYCSnapshot() {
  const snapOverlay = document.getElementById('snapshotOverlay');
  const snapImg = document.getElementById('kycSnapshotImg');
  const btnRun = document.getElementById('btnRunKYC');
  const resBox = document.getElementById('kycResultBox');
  const btnShutter = document.getElementById('btnShutter');

  if (currentSnapshotUrl) {
    try { URL.revokeObjectURL(currentSnapshotUrl); } catch (e) {}
    currentSnapshotUrl = null;
  }

  if (snapOverlay) snapOverlay.style.display = 'none';
  if (snapImg) snapImg.src = '';
  if (btnShutter) btnShutter.disabled = false;
  if (btnRun) {
    btnRun.disabled = true;
    btnRun.classList.remove('btn-pulse');
  }
  if (resBox) resBox.style.display = 'none';
  state.selfieFile = null;

  startKYCCamera();
}

function switchCameraFacing() {
  kycFacingMode = kycFacingMode === 'user' ? 'environment' : 'user';
  log(`Kamera almashtirildi: ${kycFacingMode === 'user' ? 'Old (Selfie)' : 'Orqa kamera'}`, LEVELS.INFO);
  startKYCCamera();
}

function handleSelfieFile(e) {
  const files = e.target.files;
  if (!files || !files.length) return;

  const file = files[0];
  state.selfieFile = file;

  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = document.getElementById('kycSelfieImg');
    const prompt = document.getElementById('selfieUploadPrompt');
    const status = document.getElementById('kycSelfieStatus');
    const btn = document.getElementById('btnRunKYC');

    if (img) {
      img.src = ev.target.result;
      img.style.display = 'block';
    }
    if (prompt) prompt.style.display = 'none';
    if (status) {
      status.textContent = `✓ Yuklandi: ${file.name.substring(0, 16)}...`;
      status.className = 'kyc-photo-status text-ok';
    }
    if (btn) {
      btn.disabled = false;
      btn.classList.add('btn-pulse');
    }
    log(`Selfie fayli tanlandi: ${file.name} (${formatBytes(file.size)})`, LEVELS.INFO);
  };
  reader.readAsDataURL(file);
}

async function runKYCFaceMatch() {
  if (!state.file || !state.selfieFile) {
    showError('Fayllar yetarli emas', 'Iltimos, avval hujjat va jonli selfie rasmini tanlang.');
    return;
  }

  const btn = document.getElementById('btnRunKYC');
  btn.disabled = true;
  btn.textContent = 'Biometrik solishtirilmoqda...';

  const resBox = document.getElementById('kycResultBox');
  const banner = document.getElementById('kycBanner');
  const details = document.getElementById('kycDetails');

  try {
    const fd = new FormData();
    fd.append('document_image', state.file);
    fd.append('selfie_image', state.selfieFile);
    fd.append('threshold', 72.0);

    log('KYC 1:1 Face Match tahlili boshlandi...', LEVELS.INFO);
    const data = await apiRequest(CONFIG.ENDPOINTS.FACE_MATCH, fd);

    resBox.style.display = 'block';

    const isMatch = data.match;
    const pct = data.similarity_percentage;
    const verdict = data.verdict;

    let bannerClass = isMatch ? 'match' : (verdict === 'UNCERTAIN' ? 'uncertain' : 'mismatch');
    let verdictText = isMatch 
      ? `✅ SHAXS TASDIQLANDI: ${pct}% Moslik` 
      : (verdict === 'UNCERTAIN' ? `⚠️ QISMAN MOS: ${pct}%` : `❌ SHAXS MOS EMAS: ${pct}%`);

    banner.className = `kyc-result-banner ${bannerClass}`;
    banner.innerHTML = `
      <span>${verdictText}</span>
      <span style="font-size:12px;font-weight:600;padding:2px 8px;border-radius:4px;background:rgba(0,0,0,0.2);">${verdict}</span>
    `;

    details.innerHTML = `
      <span>Tahlil vaqti: <strong>${data.processing_time_ms}ms</strong></span>
      <span>Bo'sag'a: <strong>${data.threshold_applied}%</strong></span>
      <span>LBP Tekstura: <strong>${((data.details?.spatial_lbp_similarity || 0) * 100).toFixed(1)}%</strong></span>
      <span>Anatomiya: <strong>${((data.details?.structural_correlation || 0) * 100).toFixed(1)}%</strong></span>
    `;

    log(`KYC Natijasi: ${verdictText}, server=${data.processing_time_ms}ms`, isMatch ? LEVELS.OK : LEVELS.WARN);

  } catch (err) {
    resBox.style.display = 'block';
    banner.className = 'kyc-result-banner mismatch';

    let errorMsg = err.message || 'Tahlil qilib bo\'lmadi';
    let detailMsg = 'Iltimos, har ikkala rasmda yuz aniq ko\'rinayotganini tekshiring.';

    if (err instanceof APIError && err.body) {
      if (err.body.error) errorMsg = err.body.error;
      if (err.body.details) {
        detailMsg = typeof err.body.details === 'object' 
          ? Object.values(err.body.details).flat().join(', ')
          : String(err.body.details);
      }
    }

    banner.innerHTML = `<span>🚨 Xatolik: ${escapeHtml(errorMsg)}</span>`;
    details.innerHTML = `<span>${escapeHtml(detailMsg)}</span>`;
    log(`KYC Xatosi: ${errorMsg}`, LEVELS.ERROR);
  } finally {
    btn.disabled = false;
    btn.textContent = '⚡ Solishtirish (Face Match)';
  }
}

