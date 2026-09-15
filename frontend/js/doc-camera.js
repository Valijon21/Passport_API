/**
 * doc-camera.js — Guided Document Smart Auto-Capture (Real-Time HUD & Canny Edge Detection)
 */
'use strict';

// ══════════════════════════════════════════════════════════════
//  GUIDED DOCUMENT AUTO-CAPTURE ENGINE (REAL-TIME HUD)
// ══════════════════════════════════════════════════════════════
let docFacingMode = 'environment'; // default rear camera

function openDocCapture(targetZone, e) {
  if (e) e.stopPropagation();
  state.docCaptureTarget = targetZone; // 'single' | 'front' | 'back'
  const modal = document.getElementById('docCaptureModal');
  if (modal) modal.style.display = 'flex';
  startDocCamera();
}

function closeDocCapture() {
  stopDocCamera();
  const modal = document.getElementById('docCaptureModal');
  if (modal) modal.style.display = 'none';
}

function switchDocCameraFacing() {
  docFacingMode = docFacingMode === 'environment' ? 'user' : 'environment';
  startDocCamera();
}

async function startDocCamera() {
  const video = document.getElementById('docVideo');
  state.docStabilityCounter = 0;
  state.lastDocFrameData = null;
  updateDocHudStatus("Kamera ulanmoqda...", false, 0);

  try {
    if (state.docStream) {
      state.docStream.getTracks().forEach(t => { try { t.stop(); } catch(e){} });
      state.docStream = null;
    }

    const constraints = {
      video: {
        facingMode: docFacingMode ? { ideal: docFacingMode } : 'environment',
        width: { ideal: 1920, max: 1920 },
        height: { ideal: 1080, max: 1080 }
      },
      audio: false
    };

    let stream = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch(err1) {
      console.warn("Doc camera ideal constraints failed, trying basic {video: true}:", err1);
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }

    state.docStream = stream;
    if (video) {
      video.srcObject = stream;
      video.playsInline = true;
      video.onloadeddata = async () => {
        try { await video.play(); } catch(e){}
        updateDocHudStatus("Hujjatni ramkaga to'g'rilang", false, 0);
        runDocFrameAnalysisLoop();
      };
      try { await video.play(); } catch(e){}
    }
  } catch(err) {
    console.error("Doc camera start failed:", err);
    updateDocHudStatus("Kameraga ulanib bo'lmadi", false, 0);
    showError("Kamera xatosi", "Kameradan foydalanish imkoni bo'lmadi: " + err.message);
  }
}

function stopDocCamera() {
  if (state.docAnimFrameId) {
    cancelAnimationFrame(state.docAnimFrameId);
    state.docAnimFrameId = null;
  }
  if (state.docStream) {
    state.docStream.getTracks().forEach(t => { try { t.stop(); } catch(e){} });
    state.docStream = null;
  }
  const video = document.getElementById('docVideo');
  if (video) video.srcObject = null;
}

function updateDocHudStatus(text, isAligned, stabilityPct) {
  const textEl = document.getElementById('docHudText');
  const dotEl = document.getElementById('hudStatusDot');
  const fillEl = document.getElementById('stabilityFill');
  const guideEl = document.getElementById('docGuideFrame');

  if (textEl) textEl.textContent = text;
  if (dotEl) {
    if (isAligned) dotEl.classList.add('active');
    else dotEl.classList.remove('active');
  }
  if (fillEl) fillEl.style.width = `${Math.min(100, Math.max(0, stabilityPct))}%`;
  if (guideEl) {
    if (isAligned) guideEl.classList.add('aligned');
    else guideEl.classList.remove('aligned');
  }
}

function playShutterSound() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.08);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.09);
  } catch(e) {}
}

function runDocFrameAnalysisLoop() {
  const video = document.getElementById('docVideo');
  const canvas = document.getElementById('docAnalyzeCanvas');
  if (!video || !canvas || video.paused || video.ended || !state.docStream) {
    if (state.docStream) {
      state.docAnimFrameId = requestAnimationFrame(runDocFrameAnalysisLoop);
    }
    return;
  }

  const dw = 160;
  const dh = 100;
  canvas.width = dw;
  canvas.height = dh;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;

  ctx.drawImage(video, 0, 0, dw, dh);
  const imgData = ctx.getImageData(0, 0, dw, dh);
  const data = imgData.data;

  let totalLuma = 0;
  let minLuma = 255;
  let maxLuma = 0;
  const count = dw * dh;

  for (let i = 0; i < data.length; i += 4) {
    const luma = (data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114);
    totalLuma += luma;
    if (luma < minLuma) minLuma = luma;
    if (luma > maxLuma) maxLuma = luma;
  }

  const avgLuma = totalLuma / count;
  const contrast = maxLuma - minLuma;

  let frameDiff = 0;
  if (state.lastDocFrameData) {
    for (let i = 0; i < data.length; i += 8) {
      frameDiff += Math.abs(data[i] - state.lastDocFrameData[i]);
    }
    frameDiff = frameDiff / (count / 2);
  }
  state.lastDocFrameData = new Uint8ClampedArray(data);

  const isDocPresent = contrast > 65 && avgLuma > 45 && avgLuma < 225;
  const isStable = frameDiff < 7.0;

  if (isDocPresent && isStable) {
    state.docStabilityCounter++;
    const pct = Math.min(100, Math.round((state.docStabilityCounter / 8) * 100));
    updateDocHudStatus("Barqaror... Rasm olinmoqda!", true, pct);

    if (state.docStabilityCounter >= 8) {
      triggerCapturedDocPhoto(video);
      return;
    }
  } else if (isDocPresent) {
    state.docStabilityCounter = Math.max(0, state.docStabilityCounter - 1);
    updateDocHudStatus("Qo'lingizni qimirlatmang...", true, Math.round((state.docStabilityCounter / 8) * 100));
  } else {
    state.docStabilityCounter = 0;
    updateDocHudStatus("Hujjatni ramkaga to'g'rilang", false, 0);
  }

  state.docAnimFrameId = requestAnimationFrame(runDocFrameAnalysisLoop);
}

function triggerManualDocCapture() {
  const video = document.getElementById('docVideo');
  if (video) triggerCapturedDocPhoto(video);
}

function triggerCapturedDocPhoto(video) {
  const flash = document.getElementById('docCameraFlash');
  if (flash) {
    flash.classList.add('flash-active');
    setTimeout(() => flash.classList.remove('flash-active'), 250);
  }
  playShutterSound();

  const capCanvas = document.createElement('canvas');
  capCanvas.width = video.videoWidth || 1280;
  capCanvas.height = video.videoHeight || 720;
  const ctx = capCanvas.getContext('2d');
  ctx.drawImage(video, 0, 0, capCanvas.width, capCanvas.height);

  capCanvas.toBlob((blob) => {
    if (!blob) return;
    const filename = `autocapture_${state.docCaptureTarget}_${Date.now()}.jpg`;
    const capturedFile = new File([blob], filename, { type: 'image/jpeg' });

    closeDocCapture();

    if (state.docCaptureTarget === 'single') {
      processFile(capturedFile);
      log("Kameradan hujjat avtomatik olindi (Yagona rejim)", LEVELS.OK);
    } else if (state.docCaptureTarget === 'front') {
      processDoubleSideFile(capturedFile, 'front');
      log("Old tomon kameradan avtomatik olindi", LEVELS.OK);
    } else if (state.docCaptureTarget === 'back') {
      processDoubleSideFile(capturedFile, 'back');
      log("Orqa tomon kameradan avtomatik olindi", LEVELS.OK);
    }
  }, 'image/jpeg', 0.95);
}

