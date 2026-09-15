/**
 * liveness.js — Active & Passive Liveness Challenge State Machine & Anti-Spoofing
 */
'use strict';

// ══════════════════════════════════════════════════════════════
//  ACTIVE & PASSIVE LIVENESS CHALLENGE STATE MACHINE
// ══════════════════════════════════════════════════════════════
async function runLivenessChallengeFlow() {
  log("Jonlilik tekshiruvi: yangi sessiya ochilmoqda...", LEVELS.INFO);
  const btn = document.getElementById('btnTriggerLiveness');
  if (btn) btn.disabled = true;

  try {
    const res = await fetch(`${CONFIG.API_BASE}${CONFIG.ENDPOINTS.LIVENESS_CHALLENGE}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ num_challenges: 2 })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      showError("Jonlilik Xatosi", data.error || "Sessiya ochib bo'lmadi");
      if (btn) btn.disabled = false;
      return;
    }

    state.livenessSession = data;
    state.livenessFrames = [];
    log(`Jonlilik topshiriqlari olindi (${data.challenges.length} ta). Tayyorlaning...`, LEVELS.OK);

    const hud = document.getElementById('livenessHud');
    const guide = document.getElementById('cameraGuide');
    if (hud) hud.style.display = 'flex';
    if (guide) guide.style.display = 'none';

    // Step 0: Baseline frontal face
    updateLivenessHud(0, "To'g'riga qarang (Neytral yuz)", "😐", 3);
    await waitLivenessCountdown(3);
    const baseBlob = await captureVideoFrameBlob();
    state.livenessFrames.push(baseBlob);
    log("1-kadr (Neytral) saqlandi.", LEVELS.INFO);

    // Steps 1..N: Execution
    for (let i = 0; i < data.challenges.length; i++) {
      const ch = data.challenges[i];
      updateLivenessHud(i + 1, ch.instruction, ch.icon, 3);
      await waitLivenessCountdown(3);
      const actionBlob = await captureVideoFrameBlob();
      state.livenessFrames.push(actionBlob);
      log(`${i + 2}-kadr (${ch.id}) saqlandi.`, LEVELS.INFO);
    }

    if (hud) hud.style.display = 'none';
    if (guide) guide.style.display = 'flex';

    await submitLivenessVerification();

  } catch (err) {
    const hud = document.getElementById('livenessHud');
    if (hud) hud.style.display = 'none';
    showError("Tarmoq Xatosi", err.message);
    log(`Jonlilik xatosi: ${err.message}`, LEVELS.ERROR);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function updateLivenessHud(step, prompt, icon, seconds) {
  const iconEl = document.getElementById('livenessIcon');
  const titleEl = document.getElementById('livenessStepTitle');
  const promptEl = document.getElementById('livenessPrompt');
  const timerEl = document.getElementById('livenessTimer');
  const barEl = document.getElementById('livenessProgressBar');

  if (iconEl) iconEl.textContent = icon || '🎯';
  if (titleEl) titleEl.textContent = `${step + 1}-bosqich`;
  if (promptEl) promptEl.textContent = prompt;
  if (timerEl) timerEl.textContent = `${seconds}s`;
  if (barEl) barEl.style.width = '0%';
}

function waitLivenessCountdown(seconds) {
  return new Promise((resolve) => {
    let remaining = seconds;
    const timerEl = document.getElementById('livenessTimer');
    const barEl = document.getElementById('livenessProgressBar');

    const interval = setInterval(() => {
      remaining--;
      if (timerEl) timerEl.textContent = `${Math.max(1, remaining)}s`;
      if (barEl) barEl.style.width = `${((seconds - remaining) / seconds) * 100}%`;

      if (remaining <= 0) {
        clearInterval(interval);
        resolve();
      }
    }, 1000);
  });
}

function captureVideoFrameBlob() {
  const video = document.getElementById('kycVideo');
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.90);
  });
}

async function submitLivenessVerification() {
  log("Jonlilik va Anti-Spoofing tekshirilmoqda...", LEVELS.INFO);
  const formData = new FormData();
  formData.append('token', state.livenessSession.token);

  for (let i = 0; i < state.livenessFrames.length; i++) {
    const blob = state.livenessFrames[i];
    formData.append('frames', blob, `frame_${i}.jpg`);
  }

  const res = await fetch(`${CONFIG.API_BASE}${CONFIG.ENDPOINTS.LIVENESS_VERIFY}`, {
    method: 'POST',
    body: formData
  });
  const data = await res.json();

  const verdictCard = document.getElementById('livenessVerdictCard');
  const badge = document.getElementById('livenessVerdictBadge');
  const text = document.getElementById('livenessVerdictText');

  if (verdictCard) verdictCard.style.display = 'flex';

  if (res.ok && data.is_live) {
    log(`Jonlilik TASDIQLANDI! Ball: ${data.liveness_score}%`, LEVELS.OK);
    if (badge) {
      badge.className = 'match-tag tag-match';
      badge.textContent = `✓ JONLILIK TASDIQLANDI (${data.liveness_score}%)`;
    }
    if (text) {
      text.textContent = "Foydalanuvchi haqiqiy tirik inson ekanligi va hech qanday ekran/qog'oz soxtaligi yo'qligi isbotlandi.";
    }

    if (data.selfie_crop_base64) {
      const snapImg = document.getElementById('kycSnapshotImg');
      if (snapImg) snapImg.src = data.selfie_crop_base64;
      document.getElementById('snapshotOverlay').style.display = 'block';
      document.getElementById('cameraGuide').style.display = 'none';
      document.getElementById('cameraShutterBar').style.display = 'none';

      fetch(data.selfie_crop_base64)
        .then(r => r.blob())
        .then(b => {
          state.selfieFile = new File([b], 'verified_liveness_selfie.jpg', { type: 'image/jpeg' });
          document.getElementById('btnRunKYC').disabled = false;
        });
    }
  } else {
    log(`Jonlilik rad etildi: ${data.verdict || data.error}`, LEVELS.ERROR);
    if (badge) {
      badge.className = 'match-tag tag-mismatch';
      badge.textContent = `✕ SOXTALIK / RAD ETILDI (${data.liveness_score || 0}%)`;
    }
    if (text) {
      text.textContent = data.error || (data.passive_anti_spoofing?.flags?.[0]) || "Harakatlar muvaffaqiyatsiz yoki soxtalashtirish aniqlandi.";
    }
  }
}

// ── Utils ─────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

