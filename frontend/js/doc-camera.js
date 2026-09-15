/**
 * doc-camera.js — Professional Document Camera HUD with Manual Shutter & Real-Time Alignment
 */
'use strict';

// ══════════════════════════════════════════════════════════════
//  PROFESSIONAL DOCUMENT CAMERA HUD ENGINE
// ══════════════════════════════════════════════════════════════
let docFacingMode = 'environment'; // default rear camera

function openDocCapture(targetZone, e) {
  if (e) e.stopPropagation();
  state.docCaptureTarget = targetZone || 'single'; // 'single' | 'front' | 'back'
  state.docCaptureMode = 'manual'; // Default to manual control per user requirements

  const modal = document.getElementById('docCaptureModal');
  if (modal) modal.style.display = 'flex';

  // Set default manual mode in UI
  setDocCaptureMode('manual');

  // Register keyboard shortcuts (Space / Enter = capture, Escape = close)
  window.removeEventListener('keydown', handleDocCamKeyDown);
  window.addEventListener('keydown', handleDocCamKeyDown);

  startDocCamera();
}

function closeDocCapture() {
  window.removeEventListener('keydown', handleDocCamKeyDown);
  stopDocCamera();

  const modal = document.getElementById('docCaptureModal');
  if (modal) modal.style.display = 'none';

  // Reset shutter ready state
  const shutterBtn = document.getElementById('btnDocManualShutter');
  if (shutterBtn) shutterBtn.classList.remove('shutter-ready');
}

function setDocCaptureMode(mode) {
  state.docCaptureMode = mode; // 'manual' | 'auto'
  state.docStabilityCounter = 0;

  const btnManual = document.getElementById('btnModeManual');
  const btnAuto = document.getElementById('btnModeAuto');
  const shutterLabel = document.getElementById('shutterLabel');
  const shutterBtn = document.getElementById('btnDocManualShutter');

  if (btnManual && btnAuto) {
    if (mode === 'manual') {
      btnManual.classList.add('active');
      btnAuto.classList.remove('active');
      if (shutterLabel) shutterLabel.textContent = "📸 Suratga olish";
      if (shutterBtn) shutterBtn.title = "Suratga olish (Spacebar yoki Enter)";
      updateDocHudStatus("Hujjatni ramkaga to'g'rilang va 📸 tugmasini bosing", false, 0);
    } else {
      btnAuto.classList.add('active');
      btnManual.classList.remove('active');
      if (shutterLabel) shutterLabel.textContent = "⚡ Avto-tutish faol";
      if (shutterBtn) shutterBtn.title = "Qo'lda tushirish yoki kutish";
      updateDocHudStatus("Hujjatni qimirlatmasdan ushlang (Avto)", false, 0);
    }
  }
}

function handleDocCamKeyDown(e) {
  const modal = document.getElementById('docCaptureModal');
  if (!modal || modal.style.display === 'none') return;

  if (e.code === 'Space' || e.code === 'Enter') {
    e.preventDefault();
    triggerManualDocCapture();
  } else if (e.code === 'Escape') {
    e.preventDefault();
    closeDocCapture();
  }
}

function switchDocCameraFacing() {
  docFacingMode = docFacingMode === 'environment' ? 'user' : 'environment';
  startDocCamera();
}

async function startDocCamera() {
  const video = document.getElementById('docVideo');
  state.docStabilityCounter = 0;
  state.lastDocFrameData = null;

  const resBadge = document.getElementById('camResBadge');
  if (resBadge) resBadge.textContent = "Ulanmoqda...";

  updateDocHudStatus("Kamera ishga tushirilmoqda...", false, 0);

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
      console.warn("Doc camera ideal constraints failed, trying basic fallback {video: true}:", err1);
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }

    state.docStream = stream;
    if (video) {
      video.srcObject = stream;
      video.playsInline = true;
      video.onloadeddata = async () => {
        try { await video.play(); } catch(e){}
        const vw = video.videoWidth || 1280;
        const vh = video.videoHeight || 720;
        if (resBadge) {
          resBadge.textContent = `${vw}x${vh}` + (vw >= 1920 ? ' FHD' : vw >= 1280 ? ' HD' : '');
        }
        updateDocHudStatus(state.docCaptureMode === 'manual'
          ? "Hujjatni ramkaga to'g'rilang va 📸 tugmasini bosing"
          : "Hujjatni qimirlatmay ushlang (Avto)", false, 0);
        runDocFrameAnalysisLoop();
      };
      try { await video.play(); } catch(e){}
    }
  } catch(err) {
    console.error("Doc camera start failed:", err);
    if (resBadge) resBadge.textContent = "Xatolik";
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

/**
 * Realistic two-stage mechanical SLR camera shutter sound
 */
function playShutterSound() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const t = ctx.currentTime;

    // Stage 1: Mirror/Curtain release click
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(1400, t);
    osc1.frequency.exponentialRampToValueAtTime(320, t + 0.045);
    gain1.gain.setValueAtTime(0.4, t);
    gain1.gain.exponentialRampToValueAtTime(0.01, t + 0.045);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(t);
    osc1.stop(t + 0.05);

    // Stage 2: Shutter closure mechanical latch
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(500, t + 0.06);
    osc2.frequency.exponentialRampToValueAtTime(120, t + 0.12);
    gain2.gain.setValueAtTime(0.35, t + 0.06);
    gain2.gain.exponentialRampToValueAtTime(0.01, t + 0.12);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(t + 0.06);
    osc2.stop(t + 0.13);
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
  const shutterBtn = document.getElementById('btnDocManualShutter');

  if (isDocPresent && isStable) {
    state.docStabilityCounter++;
    const maxThresh = state.docCaptureMode === 'auto' ? 18 : 8;
    const pct = Math.min(100, Math.round((state.docStabilityCounter / maxThresh) * 100));

    if (shutterBtn) shutterBtn.classList.add('shutter-ready');

    if (state.docCaptureMode === 'auto') {
      const countdown = Math.max(1, Math.ceil((18 - state.docStabilityCounter) / 6));
      updateDocHudStatus(`⚡ Barqaror! Rasm olinmoqda (${countdown})...`, true, pct);

      if (state.docStabilityCounter >= 18) {
        triggerCapturedDocPhoto(video);
        return;
      }
    } else {
      // MANUAL MODE (Default): Guide the user, NEVER take unwanted photos!
      updateDocHudStatus("🟢 Hujjat to'g'ri joylashdi — 📸 Suratga oling!", true, pct);
    }
  } else if (isDocPresent) {
    state.docStabilityCounter = Math.max(0, state.docStabilityCounter - 1);
    const maxThresh = state.docCaptureMode === 'auto' ? 18 : 8;
    const pct = Math.min(100, Math.round((state.docStabilityCounter / maxThresh) * 100));

    if (shutterBtn) shutterBtn.classList.remove('shutter-ready');
    updateDocHudStatus("🟡 Hujjatni qimirlatmay ushlang...", true, pct);
  } else {
    state.docStabilityCounter = 0;
    if (shutterBtn) shutterBtn.classList.remove('shutter-ready');
    updateDocHudStatus(state.docCaptureMode === 'auto'
      ? "Hujjatni ramkaga to'g'rilang (Avto)"
      : "Hujjatni ramkaga to'g'rilang va 📸 tugmasini bosing", false, 0);
  }

  state.docAnimFrameId = requestAnimationFrame(runDocFrameAnalysisLoop);
}

function triggerManualDocCapture() {
  const video = document.getElementById('docVideo');
  if (video && video.readyState >= 2) {
    triggerCapturedDocPhoto(video);
  }
}

function triggerCapturedDocPhoto(video) {
  // 1. Shutter Flash Feedback
  const flash = document.getElementById('docCameraFlash');
  if (flash) {
    flash.classList.add('flash-active');
    setTimeout(() => flash.classList.remove('flash-active'), 250);
  }

  // 2. Realistic Audio Feedback
  playShutterSound();

  // 3. Mobile Tactile Haptic Vibration
  try {
    if (navigator.vibrate) navigator.vibrate([35, 25, 50]);
  } catch(e) {}

  // 4. Full Resolution Canvas Capture
  const capCanvas = document.createElement('canvas');
  const targetW = video.videoWidth || 1920;
  const targetH = video.videoHeight || 1080;
  capCanvas.width = targetW;
  capCanvas.height = targetH;

  const ctx = capCanvas.getContext('2d');
  ctx.drawImage(video, 0, 0, targetW, targetH);

  capCanvas.toBlob((blob) => {
    if (!blob) return;
    const modePrefix = state.docCaptureMode === 'auto' ? 'auto' : 'manual';
    const filename = `${modePrefix}_${state.docCaptureTarget}_${Date.now()}.jpg`;
    const capturedFile = new File([blob], filename, { type: 'image/jpeg' });

    closeDocCapture();

    if (typeof showToast === 'function') {
      showToast("📸 Hujjat surati olindi, tahlil qilinmoqda...", 'success', 2500);
    }

    if (state.docCaptureTarget === 'single') {
      processFile(capturedFile);
      log("Hujjat kamerada suratga olindi (Yagona rejim)", LEVELS.OK);
    } else if (state.docCaptureTarget === 'front') {
      processDoubleSideFile(capturedFile, 'front');
      log("Old tomon kamerada suratga olindi", LEVELS.OK);
    } else if (state.docCaptureTarget === 'back') {
      processDoubleSideFile(capturedFile, 'back');
      log("Orqa tomon kamerada suratga olindi", LEVELS.OK);
    }
  }, 'image/jpeg', 0.98);
}
