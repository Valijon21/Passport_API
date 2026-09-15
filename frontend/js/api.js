/**
 * api.js — Backend HTTP API Calls, Health Check, and OCR Runners
 */
'use strict';

// ══════════════════════════════════════════════════════════════
//  API CALLS
// ══════════════════════════════════════════════════════════════
async function apiRequest(endpoint, formData) {
  const url = CONFIG.API_BASE + endpoint;
  log(`POST ${url}`, LEVELS.INFO);

  const resp = await fetch(url, {
    method: 'POST',
    body: formData,
    // Don't set Content-Type — browser sets multipart boundary automatically
  });

  if (!resp.ok) {
    let errBody;
    try { errBody = await resp.json(); } catch { errBody = { error: resp.statusText }; }
    throw new APIError(resp.status, errBody);
  }

  return resp.json();
}

class APIError extends Error {
  constructor(status, body) {
    super(body?.error || `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

// ── ID Card OCR ──────────────────────────────────────────────
async function runIDCardOCR() {
  if (!state.file) return;

  const docType = document.querySelector('input[name="docType"]:checked').value;
  log(`ID karta OCR boshlandi (doc_type=${docType})...`, LEVELS.INFO);

  setLoading(true, 'btnScan', 'Rasm qayta ishlanmoqda...');
  hideError();
  hideResults();

  try {
    const fd = new FormData();
    fd.append('image', state.file);
    fd.append('doc_type', docType);

    const t0 = performance.now();
    const data = await apiRequest(CONFIG.ENDPOINTS.ID_CARD, fd);
    const elapsed = Math.round(performance.now() - t0);

    log(`OCR tugadi: conf=${data.confidence}%, server=${data.processing_time_ms}ms, client=${elapsed}ms`, LEVELS.OK);

    state.lastResult = data;
    state.lastResultType = 'id';
    renderIDResult(data);

  } catch (err) {
    handleAPIError(err, 'ID karta OCR xatosi');
  } finally {
    setLoading(false, 'btnScan', 'Hujjatni skanerlash');
  }
}

// ── General OCR ──────────────────────────────────────────────
async function runGeneralOCR() {
  if (!state.file) return;

  log('Umumiy matn OCR boshlandi...', LEVELS.INFO);
  setLoading(true, 'btnGeneral', 'O\'qilmoqda...');
  hideError();
  hideResults();

  try {
    const fd = new FormData();
    fd.append('image', state.file);

    const t0 = performance.now();
    const data = await apiRequest(CONFIG.ENDPOINTS.GENERAL, fd);
    const elapsed = Math.round(performance.now() - t0);

    log(`Umumiy OCR tugadi: conf=${data.confidence}%, chars=${data.raw_text.length}, client=${elapsed}ms`, LEVELS.OK);

    state.lastResult = data;
    state.lastResultType = 'general';
    renderGeneralResult(data);

  } catch (err) {
    handleAPIError(err, 'Umumiy OCR xatosi');
  } finally {
    setLoading(false, 'btnGeneral', 'Oddiy matn o\'qish');
  }
}

// ── Two-Sided Smart Merge OCR ─────────────────────────────────
async function runIDCardFullOCR() {
  if (!state.frontFile || !state.backFile) {
    showError("Fayllar to'liq emas", "Iltimos, ID kartaning old va orqa tomonlarini yuklang.");
    return;
  }

  log("Two-Sided Smart Merge boshlandi (ikkala tomon tahlil qilinmoqda)...", LEVELS.INFO);
  setLoading(true, 'btnMerge', 'Ikkala tomon tahlil qilinmoqda va birlashtirilmoqda...');
  hideError();
  hideResults();

  try {
    const fd = new FormData();
    fd.append('front_image', state.frontFile);
    fd.append('back_image', state.backFile);

    const t0 = performance.now();
    const data = await apiRequest(CONFIG.ENDPOINTS.ID_FULL, fd);
    const elapsed = Math.round(performance.now() - t0);

    log(`Smart Merge muvaffaqiyatli: status=${data.validation?.overall_status}, swapped=${data.auto_swapped}, server=${data.processing_time_ms}ms, client=${elapsed}ms`, LEVELS.OK);

    state.lastResult = data;
    state.lastResultType = 'id_full';
    renderIDFullResult(data);

  } catch (err) {
    handleAPIError(err, 'Two-Sided Smart Merge xatosi');
  } finally {
    setLoading(false, 'btnMerge', '🪪 Ikkala Tomonni Birlashtirish (Two-Sided Smart Merge)');
    updateDoubleMergeBtnState();
  }
}

// ── Multi-Page PDF Dossier OCR ────────────────────────────────
async function runPdfDossierOCR() {
  if (!state.pdfFile) {
    showError("Fayl tanlanmadi", "Iltimos, PDF dossier faylini yuklang.");
    return;
  }

  log("PDF Dossier tahlili boshlandi (sahifalar ajratilmoqda va klassifikatsiya qilinmoqda)...", LEVELS.INFO);
  setLoading(true, 'btnRunPdf', 'PDF sahifalari tahlil qilinmoqda...');
  hideError();
  hideResults();

  const maxPages = document.getElementById('pdfMaxPages')?.value || '10';

  try {
    const fd = new FormData();
    fd.append('file', state.pdfFile);
    fd.append('max_pages', maxPages);

    const t0 = performance.now();
    const data = await apiRequest(CONFIG.ENDPOINTS.DOSSIER_PDF, fd);
    const elapsed = Math.round(performance.now() - t0);

    log(`PDF Dossier yakunlandi: ${data.total_pages} ta sahifa, turi=${data.dossier_type}, client=${elapsed}ms`, LEVELS.OK);

    state.lastResult = data;
    state.lastResultType = 'pdf_dossier';
    renderPdfDossierResult(data);

  } catch (err) {
    handleAPIError(err, 'PDF Dossier tahlili xatosi');
  } finally {
    setLoading(false, 'btnRunPdf', '⚡ Dossierni Tahlil Qilish (PDF OCR)');
    const btn = document.getElementById('btnRunPdf');
    if (btn) btn.disabled = !state.pdfFile;
  }
}

function handleAPIError(err, context) {
  log(`${context}: ${err.message}`, LEVELS.ERROR);

  let detail = err.message;
  if (err instanceof APIError) {
    if (err.status === 400) detail = JSON.stringify(err.body?.details || err.body, null, 2);
    if (err.status === 422) detail = 'OCR rasm ma\'lumotini topa olmadi. Rasmni tekshiring.';
    if (err.status === 500) detail = err.body?.error || 'Server ichki xatosi';
    if (err.message.includes('fetch')) detail = `API serveriga ulanib bo'lmadi. Server ishlayaptimi? (${CONFIG.API_BASE})`;
  }

  showError(context, detail);
  if (err instanceof APIError && err.body?.details) {
    log(`Validatsiya: ${JSON.stringify(err.body.details)}`, LEVELS.WARN);
  }
}


// ── Health Check ─────────────────────────────────────────────
async function checkHealth() {
  log('Tizim holati tekshirilmoqda...', LEVELS.INFO);
  const dot = document.getElementById('healthDot');
  dot.className = 'health-dot';

  try {
    const resp = await fetch(CONFIG.API_BASE + CONFIG.ENDPOINTS.HEALTH);
    const data = await resp.json();

    const tess = data.tesseract;
    const cv   = data.opencv;
    const langs = (data.languages || []).join(', ');

    const ok = data.status === 'ok';
    dot.className = 'health-dot ' + (ok ? 'ok' : 'warn');

    document.getElementById('healthContent').innerHTML = `
      <div class="health-item">
        <span class="health-item-label">Tizim holati</span>
        <span class="health-item-val ${ok ? 'health-ok' : 'health-err'}">${ok ? '✓ ISHLAYAPTI' : '△ DEGRADED'}</span>
      </div>
      <div class="health-item">
        <span class="health-item-label">Tesseract OCR</span>
        <span class="health-item-val ${tess?.available ? 'health-ok' : 'health-err'}">
          ${tess?.available ? `✓ v${tess.version}` : `✗ ${tess?.error || 'Topilmadi'}`}
        </span>
      </div>
      <div class="health-item">
        <span class="health-item-label">OpenCV</span>
        <span class="health-item-val ${cv?.available ? 'health-ok' : 'health-err'}">
          ${cv?.available ? `✓ v${cv.version}` : `✗ Topilmadi`}
        </span>
      </div>
      <div class="health-langs">
        Tillar: ${langs || '—'}
      </div>
    `;

    document.getElementById('healthModal').style.display = 'flex';
    log(`Health: ${data.status}, Tesseract=${tess?.version}, langs=[${langs}]`, ok ? LEVELS.OK : LEVELS.WARN);

  } catch (e) {
    dot.className = 'health-dot err';
    document.getElementById('healthContent').innerHTML = `
      <div class="health-item">
        <span class="health-item-label">API server</span>
        <span class="health-item-val health-err">✗ Ulanmadi</span>
      </div>
      <div style="color:var(--text3);font-size:12px;margin-top:12px;">
        Server manzili: <code>${CONFIG.API_BASE}</code><br>
        Django serverni ishga tushiring: <code>python manage.py runserver</code>
      </div>
    `;
    document.getElementById('healthModal').style.display = 'flex';
    log(`Health check muvaffaqiyatsiz: ${e.message}`, LEVELS.ERROR);
  }
}

function closeModal() {
  document.getElementById('healthModal').style.display = 'none';
}

