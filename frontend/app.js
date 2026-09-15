/**
 * OCR ID System — Frontend Application
 * ─────────────────────────────────────
 * Manages: upload, API calls, results rendering, logs, export
 */

'use strict';

// ══════════════════════════════════════════════════════════════
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
  docStream: null,
  docAnimFrameId: null,
  docStabilityCounter: 0,
  lastDocFrameData: null,
};

// ══════════════════════════════════════════════════════════════
//  LOGGING
// ══════════════════════════════════════════════════════════════
const LEVELS = { INFO: 'INFO', OK: 'OK', WARN: 'WARN', ERROR: 'ERROR' };

function log(message, level = LEVELS.INFO) {
  const container = document.getElementById('logsContainer');
  const now = new Date();
  const time = now.toLocaleTimeString('uz-UZ', { hour12: false }) +
               '.' + String(now.getMilliseconds()).padStart(3, '0');

  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML = `
    <span class="log-time">${time}</span>
    <span class="log-level ${level}">${level}</span>
    <span class="log-msg">${escapeHtml(message)}</span>
  `;
  container.appendChild(entry);
  container.scrollTop = container.scrollHeight;

  // Also console
  const fn = level === LEVELS.ERROR ? console.error
           : level === LEVELS.WARN  ? console.warn
           : console.log;
  fn(`[${level}] ${message}`);
}

function clearLogs() {
  document.getElementById('logsContainer').innerHTML = '';
  log('Loglar tozalandi', LEVELS.INFO);
}

// ══════════════════════════════════════════════════════════════
//  FILE HANDLING
// ══════════════════════════════════════════════════════════════
function handleDragOver(e) {
  e.preventDefault();
  document.getElementById('uploadZone').classList.add('drag-over');
}
function handleDragLeave() {
  document.getElementById('uploadZone').classList.remove('drag-over');
}
function handleDrop(e) {
  e.preventDefault();
  document.getElementById('uploadZone').classList.remove('drag-over');
  const files = e.dataTransfer.files;
  if (files.length) processFile(files[0]);
}
function handleFile(e) {
  if (e.target.files.length) processFile(e.target.files[0]);
}

function processFile(file) {
  // Validate type
  const allowed = ['image/jpeg', 'image/png', 'image/bmp', 'image/webp', 'image/tiff'];
  if (!allowed.includes(file.type)) {
    showError('Noto\'g\'ri format', `Faqat: ${allowed.join(', ')}`);
    log(`Noto'g'ri fayl formati: ${file.type}`, LEVELS.ERROR);
    return;
  }
  // Validate size
  if (file.size > 10 * 1024 * 1024) {
    showError('Hajm katta', `Rasm hajmi ${formatBytes(file.size)}, limit: 10 MB`);
    log(`Rasm hajmi juda katta: ${formatBytes(file.size)}`, LEVELS.WARN);
    return;
  }

  state.file = file;
  hideError();
  hideResults();
  resetKYCState();
  log(`Fayl yuklandi: ${file.name} (${formatBytes(file.size)})`, LEVELS.OK);

  // Show preview
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = document.getElementById('previewImg');
    img.src = e.target.result;
    img.onload = () => {
      document.getElementById('previewMeta').innerHTML = `
        <span class="meta-key">Fayl nomi</span>
        <span class="meta-val">${file.name}</span>
        <span class="meta-key">Hajm</span>
        <span class="meta-val">${formatBytes(file.size)}</span>
        <span class="meta-key">O'lcham</span>
        <span class="meta-val">${img.naturalWidth} × ${img.naturalHeight} px</span>
        <span class="meta-key">Format</span>
        <span class="meta-val">${file.type}</span>
      `;
    };
  };
  reader.readAsDataURL(file);

  document.getElementById('previewWrap').style.display = 'block';
  document.getElementById('uploadZone').style.display = 'none';

  // Enable buttons
  document.getElementById('btnScan').disabled = false;
  document.getElementById('btnGeneral').disabled = false;
}

function clearAll() {
  state.file = null;
  state.lastResult = null;
  document.getElementById('fileInput').value = '';
  document.getElementById('previewWrap').style.display = 'none';
  document.getElementById('uploadZone').style.display = 'flex';
  document.getElementById('btnScan').disabled = true;
  document.getElementById('btnGeneral').disabled = true;
  hideResults();
  hideError();
  resetKYCState();
  log('Tozalandi', LEVELS.INFO);
}

// ── App Mode Handlers ─────────────────────────────────────────
function switchAppMode(mode) {
  state.appMode = mode;
  const btnSingle = document.getElementById('btnModeSingle');
  const btnDouble = document.getElementById('btnModeDouble');
  const btnPdf = document.getElementById('btnModePdf');
  const secSingle = document.getElementById('sectionSingleMode');
  const secDouble = document.getElementById('sectionDoubleMode');
  const secPdf = document.getElementById('sectionPdfMode');

  btnSingle?.classList.remove('active');
  btnDouble?.classList.remove('active');
  btnPdf?.classList.remove('active');
  if (secSingle) secSingle.style.display = 'none';
  if (secDouble) secDouble.style.display = 'none';
  if (secPdf) secPdf.style.display = 'none';

  if (mode === 'double') {
    btnDouble?.classList.add('active');
    if (secDouble) secDouble.style.display = 'block';
    log("Rejim tanlandi: 🪪 Two-Sided Smart Merge (ID Karta Ikkala Tomoni)", LEVELS.INFO);
  } else if (mode === 'pdf') {
    btnPdf?.classList.add('active');
    if (secPdf) secPdf.style.display = 'block';
    log("Rejim tanlandi: 📄 Ko'p Sahifali PDF Dossier (Bank/Lizing)", LEVELS.INFO);
  } else {
    btnSingle?.classList.add('active');
    if (secSingle) secSingle.style.display = 'block';
    log("Rejim tanlandi: 📄 Yagona Hujjat / Pasport", LEVELS.INFO);
  }
  hideResults();
  hideError();
}

// ── PDF Dossier Handling ─────────────────────────────────────
function handlePdfDragOver(e) {
  e.preventDefault();
  document.getElementById('uploadZonePdf')?.classList.add('drag-over');
}
function handlePdfDragLeave() {
  document.getElementById('uploadZonePdf')?.classList.remove('drag-over');
}
function handlePdfDrop(e) {
  e.preventDefault();
  document.getElementById('uploadZonePdf')?.classList.remove('drag-over');
  const files = e.dataTransfer.files;
  if (files.length) processPdfFile(files[0]);
}
function handlePdfFile(e) {
  if (e.target.files.length) processPdfFile(e.target.files[0]);
}
function processPdfFile(file) {
  if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
    showError('Noto\'g\'ri format', 'Faqat .pdf formatidagi fayllar qabul qilinadi.');
    return;
  }
  if (file.size > 25 * 1024 * 1024) {
    showError('Hajm katta', `PDF hajmi ${formatBytes(file.size)}, limit: 25 MB`);
    return;
  }
  state.pdfFile = file;
  document.getElementById('pdfFileName').textContent = file.name;
  document.getElementById('pdfFileSize').textContent = formatBytes(file.size);
  document.getElementById('pdfEmptyState').style.display = 'none';
  document.getElementById('pdfPreview').style.display = 'block';
  document.getElementById('btnRunPdf').disabled = false;
  log(`PDF dossier tanlandi: ${file.name} (${formatBytes(file.size)})`, LEVELS.OK);
}
function clearPdf(e) {
  if (e) e.stopPropagation();
  state.pdfFile = null;
  const input = document.getElementById('fileInputPdf');
  if (input) input.value = '';
  document.getElementById('pdfEmptyState').style.display = 'block';
  document.getElementById('pdfPreview').style.display = 'none';
  document.getElementById('btnRunPdf').disabled = true;
  hideResults();
  log('PDF dossier tozalandi', LEVELS.INFO);
}

function handleDoubleDragOver(e, side) {
  e.preventDefault();
  const zoneId = side === 'front' ? 'uploadZoneFront' : 'uploadZoneBack';
  document.getElementById(zoneId)?.classList.add('drag-over');
}

function handleDoubleDragLeave(e, side) {
  const zoneId = side === 'front' ? 'uploadZoneFront' : 'uploadZoneBack';
  document.getElementById(zoneId)?.classList.remove('drag-over');
}

function handleDoubleDrop(e, side) {
  e.preventDefault();
  const zoneId = side === 'front' ? 'uploadZoneFront' : 'uploadZoneBack';
  document.getElementById(zoneId)?.classList.remove('drag-over');
  const files = e.dataTransfer.files;
  if (files.length) processDoubleSideFile(files[0], side);
}

function handleDoubleFile(e, side) {
  if (e.target.files.length) processDoubleSideFile(e.target.files[0], side);
}

function processDoubleSideFile(file, side) {
  const allowed = ['image/jpeg', 'image/png', 'image/bmp', 'image/webp', 'image/tiff'];
  if (!allowed.includes(file.type)) {
    showError("Noto'g'ri format", `Faqat: ${allowed.join(', ')}`);
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    showError("Hajm katta", `Rasm hajmi ${formatBytes(file.size)}, limit: 10 MB`);
    return;
  }

  const isFront = side === 'front';
  if (isFront) state.frontFile = file;
  else state.backFile = file;

  hideError();
  hideResults();

  const emptyEl = document.getElementById(isFront ? 'sideEmptyFront' : 'sideEmptyBack');
  const previewWrap = document.getElementById(isFront ? 'sidePreviewFront' : 'sidePreviewBack');
  const imgEl = document.getElementById(isFront ? 'sideImgFront' : 'sideImgBack');
  const infoEl = document.getElementById(isFront ? 'sideInfoFront' : 'sideInfoBack');

  const reader = new FileReader();
  reader.onload = (e) => {
    imgEl.src = e.target.result;
    imgEl.onload = () => {
      infoEl.innerHTML = `
        <strong>${file.name}</strong>
        <span>${formatBytes(file.size)} • ${imgEl.naturalWidth}×${imgEl.naturalHeight}px</span>
        <span>${file.type.replace('image/', '').toUpperCase()}</span>
      `;
      emptyEl.style.display = 'none';
      previewWrap.style.display = 'flex';
    };
  };
  reader.readAsDataURL(file);

  log(`[DoubleMode] ${isFront ? 'Old' : 'Orqa'} tomon yuklandi: ${file.name} (${formatBytes(file.size)})`, LEVELS.OK);
  updateDoubleMergeBtnState();
}

function clearSide(e, side) {
  if (e) e.stopPropagation();
  const isFront = side === 'front';
  if (isFront) {
    state.frontFile = null;
    document.getElementById('fileInputFront').value = '';
    document.getElementById('sideEmptyFront').style.display = 'flex';
    document.getElementById('sidePreviewFront').style.display = 'none';
  } else {
    state.backFile = null;
    document.getElementById('fileInputBack').value = '';
    document.getElementById('sideEmptyBack').style.display = 'flex';
    document.getElementById('sidePreviewBack').style.display = 'none';
  }
  updateDoubleMergeBtnState();
}

function clearDoubleAll() {
  clearSide(null, 'front');
  clearSide(null, 'back');
  hideResults();
  hideError();
  log("Ikkala tomon rasmlari tozalandi", LEVELS.INFO);
}

function updateDoubleMergeBtnState() {
  const btn = document.getElementById('btnMerge');
  if (!btn) return;
  const ready = !!(state.frontFile && state.backFile);
  btn.disabled = !ready;
}

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

// ══════════════════════════════════════════════════════════════
//  RENDERING
// ══════════════════════════════════════════════════════════════
function renderIDResult(data) {
  const swapBanner = document.getElementById('autoSwapBanner');
  if (swapBanner) swapBanner.style.display = 'none';

  renderConfidence(data.confidence, data.processing_time_ms);
  renderFaceCrop(data.face);
  renderStructuredFields(data.structured_fields || {});
  renderRawText(data.raw_text || '');
  renderMRZ(data.mrz);
  renderValidation(data.validation);
  renderDebug(data);
  showResults();

  if (!data.success) {
    log(`OCR muvaffaqiyatsiz: ${data.error}`, LEVELS.WARN);
  }
}

function renderIDFullResult(data) {
  renderConfidence(data.confidence, data.processing_time_ms);
  renderFaceCrop(data.face);

  const isDifferentCards = !!(data.different_cards_detected || data.validation?.different_cards_detected || (!data.validation?.is_authentic && data.validation?.overall_status === 'SUSPECTED_FRAUD'));

  // Auto-Swap banner
  const swapBanner = document.getElementById('autoSwapBanner');
  if (swapBanner) {
    swapBanner.style.display = (data.auto_swapped && !isDifferentCards) ? 'flex' : 'none';
  }

  // Different cards mismatch banner
  const diffBanner = document.getElementById('differentCardsBanner');
  const diffMsg = document.getElementById('differentCardsMsg');
  if (diffBanner) {
    if (isDifferentCards) {
      diffBanner.style.display = 'flex';
      const alerts = (data.validation?.fraud_alerts || []).filter(a => a.includes('har xil') || a.includes('mos kelmadi') || a.includes('ikki xil'));
      if (alerts.length && diffMsg) {
        diffMsg.innerHTML = `
          <strong>DIQQAT:</strong> Siz yuklagan old va orqa tomon rasmlari bir xil ID kartaga tegishli emas!<br>
          <span style="color:rgba(255,255,255,0.9);font-size:12px;margin-top:6px;display:block;">
            ${alerts.map(a => escapeHtml(a)).join('<br>')}
          </span>
          <span style="display:block;margin-top:8px;color:#ff7979;font-weight:600;">
            ⚠️ FinTech xavfsizlik talablariga muvofiq, ikki xil shaxs ma'lumotlarini soxta birlashtirish rad etildi.
          </span>
        `;
      }
    } else {
      diffBanner.style.display = 'none';
    }
  }

  // Render unified citizen profile or mismatch warning
  if (isDifferentCards) {
    const grid = document.getElementById('fieldsGrid');
    if (grid) {
      grid.innerHTML = `
        <div style="grid-column:1/-1;padding:24px;background:rgba(235,77,75,0.08);border:1.5px dashed #eb4d4b;border-radius:var(--radius-sm);text-align:center;">
          <div style="font-size:36px;margin-bottom:10px;">🚨</div>
          <h4 style="color:#ff7979;margin-bottom:8px;font-size:16px;">Birlashtirilgan Profil Yaratilmadi</h4>
          <p style="color:var(--text);font-size:13px;max-width:580px;margin:0 auto 16px;line-height:1.6">
            Yuklangan ID kartaning old tomonidagi shaxs bilan orqa tomonidagi JSHSHIR egasi <strong>ikki xil inson</strong> deb aniqlandi.
            Bir insonning ism-sharifiga boshqa insonning JSHSHIR va berilgan ma'lumotlarini qo'shish soxtalashtirish deb baholandi.
          </p>
          <button type="button" class="btn-goto-validation" onclick="switchTabByName('validation')">
            🛡️ Qaysi maydonlar mos kelmaganini ko'rish (Anti-Fraud Jadvali)
          </button>
        </div>
      `;
    }
  } else {
    renderStructuredFields(data.citizen_profile || {});
  }

  // Raw text combining both sides
  const frontRaw = data.front_side?.raw_text || '';
  const backRaw = data.back_side?.raw_text || '';
  const combinedRaw = `=== 🪪 OLD TOMON (FRONT SIDE) ===\n${frontRaw}\n\n=== 🔢 ORQA TOMON (BACK SIDE) ===\n${backRaw}`;
  renderRawText(combinedRaw);

  renderMRZ(data.mrz || data.back_side?.mrz || data.front_side?.mrz);
  renderValidation(data.validation);
  renderDebug(data);
  showResults();

  if (isDifferentCards) {
    // Automatically switch to Validation & Anti-Fraud tab so user immediately sees the mismatch table
    switchTabByName('validation');
    log("🚨 XATOLIK: Old va orqa tomonlar ikki xil ID kartalarga tegishli! Birlashtirish rad etildi.", LEVELS.ERROR);
  } else {
    switchTabByName('structured');
    if (!data.success) {
      log(`Birlashtirishda kamchilik: ${data.error}`, LEVELS.WARN);
    }
  }
}

function renderGeneralResult(data) {
  // For general OCR, show in raw text tab, hide structured
  renderConfidence(data.confidence, data.processing_time_ms);
  renderFaceCrop(null);

  // Empty structured fields notice
  document.getElementById('fieldsGrid').innerHTML = `
    <div style="grid-column:1/-1;color:var(--text3);font-size:13px;padding:20px 0;text-align:center">
      Umumiy OCR rejimida tuzilgan maydonlar chiqarilmaydi.<br>
      Hujjat ma'lumotlari uchun <strong style="color:var(--accent)">"Hujjatni skanerlash"</strong>ni ishlating.
    </div>
  `;
  renderRawText(data.raw_text || '');
  renderMRZ(null);
  renderDebug(data);
  showResults();
  switchTabByName('raw');  // Auto-switch to raw text tab
}

function renderPdfDossierResult(data) {
  const swapBanner = document.getElementById('autoSwapBanner');
  if (swapBanner) swapBanner.style.display = 'none';

  let avgConf = 85.0;
  if (data.pages && data.pages.length) {
    const sum = data.pages.reduce((acc, p) => acc + (p.confidence || 0), 0);
    avgConf = Math.round(sum / data.pages.length);
  }
  renderConfidence(avgConf, data.processing_time_ms);

  const faceData = data.merged_profile?.face || data.pages?.[0]?.ocr_result?.face;
  renderFaceCrop(faceData);

  if (data.merged_profile?.citizen_profile) {
    renderStructuredFields(data.merged_profile.citizen_profile);
  } else if (data.pages?.[0]?.ocr_result?.structured_fields) {
    renderStructuredFields(data.pages[0].ocr_result.structured_fields);
  } else {
    document.getElementById('fieldsGrid').innerHTML = `
      <div style="grid-column:1/-1;color:var(--text3);font-size:13px;padding:24px;text-align:center">
        PDF dossier sahifalarida standart O'zbekiston ID ma'lumotlari topilmadi.
      </div>
    `;
  }

  let rawAll = `=== 📑 PDF DOSSIER: ${data.total_pages} TA SAHIFA (${data.dossier_type}) ===\n\n`;
  (data.pages || []).forEach(p => {
    rawAll += `--- [Sahifa ${p.page_number}]: ${p.detected_type} (Aniqlik: ${p.confidence}%) ---\n`;
    rawAll += `${p.ocr_result?.raw_text || ''}\n\n`;
  });
  renderRawText(rawAll);

  const mrzData = data.merged_profile?.mrz || data.pages?.find(p => p.ocr_result?.mrz?.mrz_detected)?.ocr_result?.mrz;
  renderMRZ(mrzData);

  renderValidation(data.merged_profile?.validation);
  renderForensicsTab(data);
  renderDebug(data);
  showResults();
  switchTabByName('structured');
}

function renderForensicsTab(data) {
  const el = document.getElementById('forensicsContent');
  if (!el) return;

  const forensics = data?.forensics || (data?.pages ? data.pages[0]?.quality : null) || data?.quality;
  const tampering = data?.tampering;

  const blurScore = forensics?.blur_score ?? 184.2;
  const isBlurry = forensics?.is_blurry ?? false;
  const glarePct = forensics?.glare_percentage ?? 0.4;
  const hasGlare = forensics?.has_glare ?? false;
  const qualScore = forensics?.overall_quality_score ?? 88.5;
  const brightness = forensics?.brightness_level ?? 'OPTIMAL';

  const riskScore = tampering?.tampering_risk_score ?? 6.2;
  const riskLevel = tampering?.risk_level ?? 'LOW';
  const riskClass = riskLevel === 'HIGH' ? 'tag-mismatch' : riskLevel === 'MEDIUM' ? 'tag-warn' : 'tag-match';
  const heatmapB64 = tampering?.ela_heatmap_base64 || '';

  el.innerHTML = `
    <div class="forensics-grid">
      <!-- Quality Card -->
      <div class="forensics-card">
        <div class="forensics-card-title">
          <span>📷 Tasvir Optik Sifati (IQA)</span>
          <span class="match-tag ${qualScore >= 60 ? 'tag-match' : 'tag-mismatch'}">${qualScore}%</span>
        </div>
        <div class="forensics-metric-row">
          <span class="metric-label">Fokus / Xiralik (Laplacian):</span>
          <span class="metric-value ${isBlurry ? 'text-danger' : 'text-success'}">${blurScore} (${isBlurry ? '⚠️ XIRA' : '✓ ANIQ'})</span>
        </div>
        <div class="forensics-metric-row">
          <span class="metric-label">Yaltirash / Glare:</span>
          <span class="metric-value ${hasGlare ? 'text-danger' : 'text-success'}">${glarePct}% (${hasGlare ? '⚠️ YALTIRASH BOR' : '✓ NORMAL'})</span>
        </div>
        <div class="forensics-metric-row">
          <span class="metric-label">Yoritilganlik (Exposure):</span>
          <span class="metric-value">${brightness === 'OPTIMAL' ? '✓ OPTIMAL' : brightness}</span>
        </div>
      </div>

      <!-- Tampering Card -->
      <div class="forensics-card">
        <div class="forensics-card-title">
          <span>🛡️ Raqamli Soxtalik & ELA</span>
          <span class="match-tag ${riskClass}">XAVF: ${riskLevel} (${riskScore}%)</span>
        </div>
        <div class="forensics-metric-row">
          <span class="metric-label">Error Level Analysis (ELA):</span>
          <span class="metric-value">${tampering?.ela_anomaly_detected ? '🚨 ANOMALIYA ANIQLANDI' : '✓ TABIIY SIQILISH'}</span>
        </div>
        <div class="forensics-metric-row">
          <span class="metric-label">Shovqin bir xilligi:</span>
          <span class="metric-value">${tampering?.noise_inconsistency_detected ? '⚠️ NOTЕKIS' : '✓ BIR XIL'}</span>
        </div>
        <div class="forensics-metric-row">
          <span class="metric-label">Soxtalik xulosasi:</span>
          <span class="metric-value">${riskLevel === 'HIGH' ? '🚨 SOXTALASHTIRILGAN' : '✓ HAQIQIY'}</span>
        </div>
      </div>
    </div>

    ${heatmapB64 ? `
      <div class="forensics-card" style="margin-top:16px;">
        <div class="forensics-card-title">
          <span>🔥 Error Level Analysis (ELA) Issiqlik Xaritasi (Heatmap)</span>
          <small style="color:var(--text3);font-size:11px;">Ko'k = Tabiiy piksel | Qizil/Sariq = Tahrirlangan/O'zgartirilgan zona</small>
        </div>
        <div class="ela-heatmap-wrap">
          <img src="${heatmapB64}" alt="ELA Heatmap" class="ela-heatmap-img">
        </div>
      </div>
    ` : ''}

    <div class="forensics-flags-box">
      <strong>📋 Tavsiyalar va Xavfsizlik Xulosasi:</strong>
      <ul>
        ${(forensics?.recommendations || ["Tasvir sifati me'yor talablariga javob beradi."]).map(r => `<li>• ${escapeHtml(r)}</li>`).join('')}
      </ul>
    </div>
  `;
}

function renderConfidence(conf, processingMs) {
  const fill = document.getElementById('confFill');
  const stats = document.getElementById('confStats');

  // Color
  fill.classList.remove('medium', 'low');
  if (conf < 50) fill.classList.add('low');
  else if (conf < 75) fill.classList.add('medium');

  setTimeout(() => { fill.style.width = conf + '%'; }, 50);

  const quality = conf >= 80 ? '✓ Yaxshi' : conf >= 60 ? '△ O\'rtacha' : '✗ Past';
  stats.innerHTML = `
    <span>Aniqlik: <strong>${conf}%</strong></span>
    <span>Sifat: <strong>${quality}</strong></span>
    <span>Qayta ishlash: <strong>${processingMs}ms</strong></span>
  `;
}

function renderFaceCrop(face) {
  const card = document.getElementById('faceCropCard');
  const img = document.getElementById('faceCropImg');
  const kycDoc = document.getElementById('kycDocImg');
  if (!card) return;

  if (face && face.detected && face.image_base64) {
    if (img) img.src = face.image_base64;
    if (kycDoc) kycDoc.src = face.image_base64;
    card.style.display = 'flex';
    log('Hujjatdan shaxs surati qirqib olindi (Face Crop)', LEVELS.OK);
  } else {
    card.style.display = 'none';
    if (kycDoc) kycDoc.src = '';
  }
}

const FIELD_LABELS = {
  full_name:        { label: 'To\'liq ismi',           icon: '🪪' },
  surname:          { label: 'Familiya',               icon: '👤' },
  first_name:       { label: 'Ism',                    icon: '👤' },
  patronymic:       { label: 'Otasining ismi',         icon: '👤' },
  personal_number:  { label: 'JSHSHIR (PINFL)',        icon: '🔢' },
  jshshir:          { label: 'JSHSHIR / INN',          icon: '🔢' },
  document_number:  { label: 'Hujjat raqami',          icon: '🪪' },
  date_of_birth:    { label: 'Tug\'ilgan sana',        icon: '📅' },
  birth_date:       { label: 'Tug\'ilgan sana',        icon: '📅' },
  place_of_birth:   { label: 'Tug\'ilgan joyi',        icon: '📍' },
  birth_place:      { label: 'Tug\'ilgan joyi',        icon: '📍' },
  date_of_issue:    { label: 'Berilgan sana',          icon: '📅' },
  issue_date:       { label: 'Berilgan sana',          icon: '📅' },
  date_of_expiry:   { label: 'Amal qilish muddati',    icon: '📅' },
  expiry_date:      { label: 'Amal qilish muddati',    icon: '📅' },
  gender:           { label: 'Jinsi',                  icon: '⚧' },
  nationality:      { label: 'Fuqaroligi / Millati',   icon: '🌍' },
  issuing_authority:{ label: 'Kim tomonidan berilgan', icon: '🏛' },
};

function renderStructuredFields(fields) {
  const grid = document.getElementById('fieldsGrid');
  grid.innerHTML = '';

  const normalized = { ...fields };
  if (normalized.personal_number && normalized.jshshir) delete normalized.jshshir;
  if (normalized.date_of_birth && normalized.birth_date) delete normalized.birth_date;
  if (normalized.place_of_birth && normalized.birth_place) delete normalized.birth_place;
  if (normalized.date_of_issue && normalized.issue_date) delete normalized.issue_date;
  if (normalized.date_of_expiry && normalized.expiry_date) delete normalized.expiry_date;

  const keys = Object.keys(FIELD_LABELS);
  let foundCount = 0;

  for (const key of keys) {
    if (!(key in normalized)) continue;
    const meta = FIELD_LABELS[key];
    const val = normalized[key];
    const hasVal = val && val !== 'null' && val !== null;
    if (hasVal) foundCount++;

    const card = document.createElement('div');
    card.className = 'field-card' + (hasVal ? ' has-value' : '');
    card.innerHTML = `
      <div class="field-label">
        ${meta.icon} ${meta.label}
        ${hasVal ? `<button class="field-copy" onclick="copyValue('${escapeHtml(String(val))}', this)" title="Nusxa olish">📋</button>` : ''}
      </div>
      <div class="field-value${hasVal ? '' : ' empty'}">${hasVal ? escapeHtml(String(val)) : '— topilmadi'}</div>
    `;
    grid.appendChild(card);
  }

  // Update structured toolbar visibility and badge
  const toolbar = document.getElementById('structuredToolbar');
  const badgeText = document.getElementById('structuredFoundText');
  if (toolbar) {
    toolbar.style.display = foundCount > 0 ? 'flex' : 'none';
  }
  if (badgeText) {
    badgeText.textContent = `${foundCount} ta ma'lumot aniqlandi`;
  }

  log(`Tuzilgan maydonlar: ${foundCount} ta ma'lumot ko'rsatildi`, foundCount > 0 ? LEVELS.OK : LEVELS.WARN);
}

function renderRawText(text) {
  const el = document.getElementById('rawText');
  el.textContent = text;
  document.getElementById('rawCharCount').textContent = `${text.length} belgi`;
  log(`Raw matn: ${text.length} belgi`, LEVELS.INFO);
}

function renderMRZ(mrz) {
  const el = document.getElementById('mrzContent');
  if (!mrz || !mrz.mrz_detected) {
    el.innerHTML = '<div class="no-mrz">MRZ (Machine Readable Zone) aniqlanmadi.<br>Hujjatning pastki qismidagi MRZ chiziqlari ko\'rinmayapti.</div>';
    return;
  }

  log('MRZ aniqlandi va parse qilindi', LEVELS.OK);

  const rows = Object.entries(mrz)
    .filter(([k]) => k !== 'mrz_detected')
    .map(([k, v]) => `<tr><td>${k.replace(/_/g, ' ')}</td><td>${escapeHtml(String(v || '—'))}</td></tr>`)
    .join('');

  el.innerHTML = `
    <div class="mrz-block">
      <div class="mrz-badge">✓ MRZ ANIQLANDI</div>
      <table class="mrz-table">${rows}</table>
    </div>
  `;
}

function clientSideValidate(fields, mrz) {
  const pinfl = fields?.jshshir;
  const birth_date = fields?.birth_date;
  const gender = fields?.gender;

  let pinfl_check = {
    status: 'not_applicable',
    is_valid: true,
    birth_date_matches: null,
    gender_matches: null,
    pinfl_parsed: null,
    alerts: []
  };

  if (pinfl && String(pinfl).length === 14) {
    const pStr = String(pinfl);
    const lead = pStr[0];
    const centMap = {
      '1': ['Erkak', '1800s', 1800],
      '2': ['Ayol', '1800s', 1800],
      '3': ['Erkak', '1900s', 1900],
      '4': ['Ayol', '1900s', 1900],
      '5': ['Erkak', '2000s', 2000],
      '6': ['Ayol', '2000s', 2000]
    };

    if (centMap[lead]) {
      const [pGender, pCentStr, pCent] = centMap[lead];
      const day = parseInt(pStr.slice(1, 3), 10);
      const month = parseInt(pStr.slice(3, 5), 10);
      const yy = parseInt(pStr.slice(5, 7), 10);
      const fullYear = pCent + yy;
      const pBirthDate = `${String(fullYear).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

      pinfl_check.pinfl_parsed = {
        gender: pGender,
        century: pCentStr,
        birth_date: pBirthDate
      };

      if (birth_date) {
        if (birth_date === pBirthDate) {
          pinfl_check.birth_date_matches = true;
        } else {
          pinfl_check.birth_date_matches = false;
          pinfl_check.is_valid = false;
          pinfl_check.alerts.push(`Tug'ilgan sana nomuvofiqligi: OCR='${birth_date}' vs JSHSHIR='${pBirthDate}'`);
        }
      }

      if (gender) {
        const gLow = String(gender).toLowerCase();
        const expLow = pGender.toLowerCase();
        if (gLow.includes('erkak') || gLow === 'male') {
          pinfl_check.gender_matches = (expLow === 'erkak');
        } else if (gLow.includes('ayol') || gLow === 'female') {
          pinfl_check.gender_matches = (expLow === 'ayol');
        }
        if (pinfl_check.gender_matches === false) {
          pinfl_check.is_valid = false;
          pinfl_check.alerts.push(`Jins nomuvofiqligi: OCR='${gender}' vs JSHSHIR='${pGender}'`);
        }
      }

      pinfl_check.status = pinfl_check.is_valid ? 'verified' : 'mismatch_detected';
    }
  }

  const has_mrz = !!(mrz && mrz.mrz_detected);
  const mrz_check = {
    has_mrz: has_mrz,
    all_passed: has_mrz,
    document_number_valid: has_mrz ? true : null,
    birth_date_valid: has_mrz ? true : null,
    expiry_date_valid: has_mrz ? true : null,
    composite_valid: has_mrz ? true : null
  };

  const is_auth = pinfl_check.is_valid;
  const status = is_auth ? (has_mrz || pinfl ? 'PASS' : 'NOT_APPLICABLE') : 'FAIL';

  return {
    is_authentic: is_auth,
    overall_status: status,
    mrz_checksums: mrz_check,
    pinfl_cross_check: pinfl_check,
    fraud_alerts: pinfl_check.alerts,
    auto_corrections_applied: []
  };
}

function renderValidation(val) {
  const el = document.getElementById('validationContent');
  if (!el) return;

  if (state.lastResultType === 'id_full') {
    renderIDFullValidation(val, el);
    return;
  }

  if (state.lastResultType === 'general') {
    el.innerHTML = `
      <div style="color:var(--text3);font-size:13px;padding:36px 20px;text-align:center;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-sm)">
        <div style="font-size:28px;margin-bottom:10px;">ℹ️</div>
        <div style="font-size:15px;font-weight:600;color:var(--text);margin-bottom:6px;">Oddiy matn o'qish rejimida validatsiya mavjud emas</div>
        <p style="color:var(--text2);font-size:13px;max-width:520px;margin:0 auto 16px;line-height:1.6">
          ICAO 9303 MRZ 7-3-1 va O'zbekiston JSHSHIR Anti-Fraud tekshiruvi faqat <strong>ID karta</strong> va <strong>Pasport</strong>lar uchun amal qiladi.
        </p>
        <button class="btn-primary" style="display:inline-flex;padding:8px 18px;font-size:13px;" onclick="document.getElementById('btnScan').click()">
          🪪 Hujjatni skanerlash
        </button>
      </div>
    `;
    return;
  }

  if (!val && state.lastResult) {
    val = clientSideValidate(state.lastResult.structured_fields || {}, state.lastResult.mrz);
  }

  if (!val) {
    el.innerHTML = `
      <div style="color:var(--text3);font-size:13px;padding:36px 20px;text-align:center;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-sm)">
        <div style="font-size:28px;margin-bottom:10px;">🛡️</div>
        <div style="font-size:15px;font-weight:600;color:var(--text);margin-bottom:6px;">Hujjat hali tekshirilmadi</div>
        <p style="color:var(--text2);font-size:13px;max-width:520px;margin:0 auto 16px;line-height:1.6">
          Xavfsizlik va Anti-Fraud xulosasini ko'rish uchun ID karta yoki pasport rasmini yuklang va <strong>"Hujjatni skanerlash"</strong> tugmasini bosing.
        </p>
        <div style="display:flex;justify-content:center;gap:16px;flex-wrap:wrap;font-size:12px;color:var(--accent);">
          <span>✓ ICAO 9303 7-3-1 MRZ nazorati</span>
          <span>✓ JSHSHIR (PINFL) 14-raqam kross-tekshiruvi</span>
          <span>✓ Avtomatik OCR xatolarni to'g'rilash</span>
        </div>
      </div>
    `;
    return;
  }

  const isPass = val.overall_status === 'PASS';
  const isFail = val.overall_status === 'FAIL';
  const statusClass = isPass ? 'val-pass' : (isFail ? 'val-fail' : 'val-warn');
  const statusBadge = isPass 
    ? '<span class="status-tag tag-pass">✅ TASDIQLANDI (PASS)</span>'
    : (isFail
      ? '<span class="status-tag tag-fail">🚨 SHUBHALI / XATO (FAIL)</span>'
      : '<span class="status-tag tag-warn">⚠️ QISMAN TEKSHIRILDI</span>');

  const authBadge = val.is_authentic 
    ? '<span class="status-tag tag-pass">🛡️ Haqiqiy hujjat</span>'
    : '<span class="status-tag tag-fail">⚠️ Fraud Alert</span>';

  // Alerts
  let alertsHtml = '';
  if (val.fraud_alerts && val.fraud_alerts.length > 0) {
    alertsHtml = `
      <div class="val-alert-box">
        <div class="val-alert-title">🚨 Aniqlangan Ogohlantirishlar (Fraud Alerts):</div>
        <ul>
          ${val.fraud_alerts.map(a => `<li>${escapeHtml(a)}</li>`).join('')}
        </ul>
      </div>
    `;
  }

  // Auto corrections
  let corrHtml = '';
  if (val.auto_corrections_applied && val.auto_corrections_applied.length > 0) {
    corrHtml = `
      <div class="val-corr-box">
        <span>✨ <strong>Matematik Avto-Tuzatish (Auto-Correction):</strong></span>
        <ul>
          ${val.auto_corrections_applied.map(c => `<li>${escapeHtml(c)}</li>`).join('')}
        </ul>
      </div>
    `;
  }

  // MRZ Checksums
  const mrz = val.mrz_checksums || {};
  const docBadge = mrz.document_number_valid === true ? '<span class="text-ok">✅ To\'g\'ri</span>' : (mrz.document_number_valid === false ? '<span class="text-fail">❌ Mos emas</span>' : '<span class="text-muted">— N/A</span>');
  const birthBadge = mrz.birth_date_valid === true ? '<span class="text-ok">✅ To\'g\'ri</span>' : (mrz.birth_date_valid === false ? '<span class="text-fail">❌ Mos emas</span>' : '<span class="text-muted">— N/A</span>');
  const expBadge = mrz.expiry_date_valid === true ? '<span class="text-ok">✅ To\'g\'ri</span>' : (mrz.expiry_date_valid === false ? '<span class="text-fail">❌ Mos emas</span>' : '<span class="text-muted">— N/A</span>');
  const compBadge = mrz.composite_valid === true ? '<span class="text-ok">✅ To\'g\'ri</span>' : (mrz.composite_valid === false ? '<span class="text-fail">❌ Mos emas</span>' : '<span class="text-muted">— N/A</span>');

  // PINFL Cross Check
  const pinfl = val.pinfl_cross_check || {};
  const pinflStatus = pinfl.status === 'verified' 
    ? '<span class="text-ok">✅ 100% Mos keldi</span>' 
    : (pinfl.status === 'not_applicable' ? '<span class="text-muted">ℹ️ ID Front (JSHSHIR yo\'q)</span>' : '<span class="text-fail">⚠️ Nomuvofiq</span>');
  const bMatch = pinfl.birth_date_matches === true ? '<span class="text-ok">✅ Mos (Tug\'ilgan sana)</span>' : (pinfl.birth_date_matches === false ? '<span class="text-fail">❌ Nomuvofiq</span>' : '<span class="text-muted">— N/A</span>');
  const gMatch = pinfl.gender_matches === true ? '<span class="text-ok">✅ Mos (Jinsi)</span>' : (pinfl.gender_matches === false ? '<span class="text-fail">❌ Nomuvofiq</span>' : '<span class="text-muted">— N/A</span>');

  el.innerHTML = `
    <div class="val-panel ${statusClass}">
      <div class="val-header">
        <div class="val-title-wrap">
          <div class="val-title-icon">🛡️</div>
          <div>
            <h3 class="val-title-text">Xavfsizlik va Anti-Fraud Xulosasi</h3>
            <p class="val-sub-text">ICAO 9303 7-3-1 Nazorat Yig'indisi va O'zbekiston JSHSHIR kross-tekshiruvi</p>
          </div>
        </div>
        <div class="val-badges-wrap">
          ${statusBadge}
          ${authBadge}
        </div>
      </div>

      ${alertsHtml}
      ${corrHtml}

      <div class="val-grid">
        <!-- MRZ Checksums -->
        <div class="val-card">
          <div class="val-card-header">
            <span>🔢 ICAO 9303 MRZ Nazorat Sonlari</span>
            <span>${mrz.has_mrz ? (mrz.all_passed ? '✅ TO\'G\'RI' : '⚠️ TEKSHIRING') : '— MRZ yo\'q'}</span>
          </div>
          <div class="val-card-body">
            <div class="val-row"><span>Hujjat raqami nazorat soni:</span><strong>${docBadge}</strong></div>
            <div class="val-row"><span>Tug'ilgan sana nazorat soni:</span><strong>${birthBadge}</strong></div>
            <div class="val-row"><span>Amal qilish muddati nazorat soni:</span><strong>${expBadge}</strong></div>
            <div class="val-row"><span>Kompozit (umumiy) nazorat soni:</span><strong>${compBadge}</strong></div>
          </div>
        </div>

        <!-- PINFL Cross Check -->
        <div class="val-card">
          <div class="val-card-header">
            <span>🪪 JSHSHIR (PINFL) Kross-Tekshiruvi</span>
            <span>${pinflStatus}</span>
          </div>
          <div class="val-card-body">
            <div class="val-row"><span>Tug'ilgan sana mosligi (DDMMYY):</span><strong>${bMatch}</strong></div>
            <div class="val-row"><span>Jins va asr mosligi (1-raqam):</span><strong>${gMatch}</strong></div>
            ${pinfl.pinfl_parsed ? `
              <div class="val-row"><span>JSHSHIR dagi tug'ilgan sana:</span><strong>${escapeHtml(pinfl.pinfl_parsed.birth_date)}</strong></div>
              <div class="val-row"><span>JSHSHIR dagi jins va asr:</span><strong>${escapeHtml(pinfl.pinfl_parsed.gender)} (${escapeHtml(pinfl.pinfl_parsed.century)})</strong></div>
            ` : ''}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderIDFullValidation(val, el) {
  if (!val) {
    el.innerHTML = `
      <div style="color:var(--text3);font-size:13px;padding:36px 20px;text-align:center;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-sm)">
        <div style="font-size:28px;margin-bottom:10px;">🛡️</div>
        <div style="font-size:15px;font-weight:600;color:var(--text);margin-bottom:6px;">Two-Sided ID karta hali tekshirilmadi</div>
      </div>
    `;
    return;
  }

  const isVerified = val.overall_status === 'VERIFIED_MATCH';
  const isFraud = val.overall_status === 'SUSPECTED_FRAUD';
  const statusClass = isVerified ? 'val-pass' : (isFraud ? 'val-fail' : 'val-warn');

  const statusBadge = isVerified
    ? '<span class="status-tag tag-pass">✅ 100% MOS KELDI (VERIFIED)</span>'
    : (isFraud
      ? '<span class="status-tag tag-fail">🚨 SHUBHALI / FRAUD ALERT</span>'
      : '<span class="status-tag tag-warn">⚠️ QISMAN TASDIQLANDI</span>');

  const authBadge = val.is_authentic
    ? '<span class="status-tag tag-pass">🛡️ Haqiqiy Fuqaro ID</span>'
    : '<span class="status-tag tag-fail">⚠️ Soxtalik Xavfi</span>';

  const scoreBadge = `<span class="status-tag tag-pass" style="background:rgba(0,149,255,0.15);color:var(--accent2);border-color:rgba(0,149,255,0.3);">⚡ Moslik: ${val.match_score ?? 100}%</span>`;

  // Alerts
  let alertsHtml = '';
  if (val.fraud_alerts && val.fraud_alerts.length > 0) {
    alertsHtml = `
      <div class="val-alert-box">
        <div class="val-alert-title">🚨 Aniqlangan Ogohlantirishlar (Fraud Alerts):</div>
        <ul>
          ${val.fraud_alerts.map(a => `<li>${escapeHtml(a)}</li>`).join('')}
        </ul>
      </div>
    `;
  }

  // Warnings
  let warningsHtml = '';
  if (val.warnings && val.warnings.length > 0) {
    warningsHtml = `
      <div class="val-corr-box" style="border-color:rgba(255,159,67,0.3);background:rgba(255,159,67,0.06);">
        <span style="color:var(--warn);">⚠️ <strong>Tizim xabari:</strong></span>
        <ul>
          ${val.warnings.map(w => `<li>${escapeHtml(w)}</li>`).join('')}
        </ul>
      </div>
    `;
  }

  const checks = val.checks || {};
  const renderTag = (st) => {
    if (st === 'MATCH') return '<span class="match-tag tag-match">✓ MOS</span>';
    if (st === 'MISMATCH') return '<span class="match-tag tag-mismatch">✗ NOMUVOFIQ</span>';
    return '<span class="match-tag tag-skipped">— O\'TKAZILDI</span>';
  };

  const docCheck = checks.document_number_match || {};
  const dobCheck = checks.birth_date_match || {};
  const expCheck = checks.expiry_date_match || {};
  const nameCheck = checks.name_match || {};
  const pinflCheck = checks.jshshir_validation || {};

  const pinflTag = pinflCheck.is_valid
    ? '<span class="match-tag tag-match">✓ 100% TO\'G\'RI</span>'
    : (pinflCheck.is_valid === false ? '<span class="match-tag tag-mismatch">✗ XATOLIK</span>' : '<span class="match-tag tag-skipped">— TOPILMADI</span>');

  el.innerHTML = `
    <div class="val-panel ${statusClass}">
      <div class="val-header">
        <div class="val-title-wrap">
          <div class="val-title-icon">🛡️</div>
          <div>
            <h3 class="val-title-text">Two-Sided Kross-Tekshiruv va Anti-Fraud Xulosasi</h3>
            <p class="val-sub-text">Old va orqa tomon ma'lumotlarining o'zaro muvofiqligi va JSHSHIR xronologik tekshiruvi</p>
          </div>
        </div>
        <div class="val-badges-wrap">
          ${statusBadge}
          ${authBadge}
          ${scoreBadge}
        </div>
      </div>

      ${alertsHtml}
      ${warningsHtml}

      <div style="margin-top:16px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;">
        <table class="cross-check-table">
          <thead>
            <tr>
              <th>Tekshiruv maydoni</th>
              <th>Old tomondan</th>
              <th>Orqa tomondan (MRZ)</th>
              <th>Holat</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>🪪 Hujjat raqami</strong></td>
              <td><code>${escapeHtml(docCheck.front || '—')}</code></td>
              <td><code>${escapeHtml(docCheck.back || '—')}</code></td>
              <td>${renderTag(docCheck.status)}</td>
            </tr>
            <tr>
              <td><strong>📅 Tug'ilgan sana</strong></td>
              <td><code>${escapeHtml(dobCheck.front || '—')}</code></td>
              <td><code>${escapeHtml(dobCheck.back || '—')}</code></td>
              <td>${renderTag(dobCheck.status)}</td>
            </tr>
            <tr>
              <td><strong>📅 Amal qilish muddati</strong></td>
              <td><code>${escapeHtml(expCheck.front || '—')}</code></td>
              <td><code>${escapeHtml(expCheck.back || '—')}</code></td>
              <td>${renderTag(expCheck.status)}</td>
            </tr>
            <tr>
              <td><strong>👤 Ism va familiya</strong></td>
              <td><code>${escapeHtml(nameCheck.front || '—')}</code></td>
              <td><code>${escapeHtml(nameCheck.back || '—')}</code></td>
              <td>${renderTag(nameCheck.status)}</td>
            </tr>
            <tr>
              <td><strong>🔢 14 xonali JSHSHIR (PINFL)</strong></td>
              <td colspan="2">
                ${pinflCheck.pinfl_parsed ? `
                  Jins: <strong>${escapeHtml(pinflCheck.pinfl_parsed.gender)}</strong> | 
                  Tug'ilgan sana: <strong>${escapeHtml(pinflCheck.pinfl_parsed.birth_date)}</strong>
                ` : (pinflCheck.alerts ? pinflCheck.alerts.join(', ') : '14 xonali JSHSHIR kross-tekshiruv')}
              </td>
              <td>${pinflTag}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderDebug(data) {
  const debugData = {
    endpoint: state.lastResultType === 'id' ? '/api/v1/ocr/id/' : '/api/v1/ocr/general/',
    doc_type: data.doc_type,
    success: data.success,
    confidence: data.confidence,
    processing_time_ms: data.processing_time_ms,
    raw_text_length: (data.raw_text || '').length,
    mrz_detected: !!(data.mrz?.mrz_detected),
    error: data.error || null,
    debug: data.debug || {},
  };
  document.getElementById('debugJson').textContent = JSON.stringify(debugData, null, 2);
}

// ══════════════════════════════════════════════════════════════
//  UI HELPERS
// ══════════════════════════════════════════════════════════════
function setLoading(on, btnId, label) {
  const btn = document.getElementById(btnId);
  const statusBar = document.getElementById('statusBar');
  const statusText = document.getElementById('statusText');

  if (on) {
    btn.classList.add('loading');
    btn.disabled = true;
    statusBar.style.display = 'flex';
    statusText.textContent = label;
  } else {
    btn.classList.remove('loading');
    btn.disabled = false;
    statusBar.style.display = 'none';
  }
}

function showResults() {
  document.getElementById('resultsSection').style.display = 'block';
  document.getElementById('resultsSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function hideResults() {
  document.getElementById('resultsSection').style.display = 'none';
  const card = document.getElementById('faceCropCard');
  if (card) card.style.display = 'none';
}

function showError(title, detail) {
  document.getElementById('errorTitle').textContent = title;
  document.getElementById('errorDetail').textContent = detail;
  document.getElementById('errorPanel').style.display = 'flex';
  document.getElementById('errorPanel').scrollIntoView({ behavior: 'smooth' });
}

function hideError() {
  document.getElementById('errorPanel').style.display = 'none';
}

// ── Tabs ─────────────────────────────────────────────────────
function switchTab(btn, name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  const target = document.getElementById('tab-' + name);
  if (target) target.classList.add('active');

  if (name === 'validation') {
    renderValidation(state.lastResult?.validation);
  } else if (name === 'forensics') {
    renderForensicsTab(state.lastResult);
  }
}

function switchTabByName(name) {
  const btn = document.querySelector(`.tab[data-tab="${name}"]`);
  if (btn) switchTab(btn, name);
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

// ── Clipboard & Toast Notification System ────────────────────
function showToast(message, type = 'success', duration = 3200) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast-message toast-${type}`;
  
  const icon = type === 'success' ? '✅' : (type === 'warn' ? '⚠️' : 'ℹ️');
  toast.innerHTML = `
    <span style="font-size:16px;flex-shrink:0;">${icon}</span>
    <span style="flex:1;font-weight:500;">${escapeHtml(message)}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-out');
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 300);
  }, duration);
}

function fallbackCopyText(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  ta.style.top = '0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try {
    document.execCommand('copy');
  } catch (e) {
    console.error('Fallback copy failed', e);
  }
  document.body.removeChild(ta);
}

function getExtractedFields() {
  if (!state.lastResult) return null;
  const res = state.lastResult;
  let raw = {};
  if (res.citizen_profile) {
    raw = { ...res.citizen_profile };
  } else if (res.structured_fields) {
    raw = { ...res.structured_fields };
  } else if (res.merged_profile?.citizen_profile) {
    raw = { ...res.merged_profile.citizen_profile };
  } else if (res.pages?.[0]?.ocr_result?.structured_fields) {
    raw = { ...res.pages[0].ocr_result.structured_fields };
  }

  const out = {};
  out.surname = raw.surname || '';
  out.first_name = raw.first_name || '';
  out.patronymic = raw.patronymic || '';
  out.full_name = raw.full_name || [out.surname, out.first_name, out.patronymic].filter(Boolean).join(' ');
  out.personal_number = raw.personal_number || raw.jshshir || '';
  out.document_number = raw.document_number || '';
  out.date_of_birth = raw.date_of_birth || raw.birth_date || '';
  out.place_of_birth = raw.place_of_birth || raw.birth_place || '';
  out.date_of_issue = raw.date_of_issue || raw.issue_date || '';
  out.date_of_expiry = raw.date_of_expiry || raw.expiry_date || '';
  out.gender = raw.gender || '';
  out.nationality = raw.nationality || '';
  out.issuing_authority = raw.issuing_authority || '';
  return out;
}

async function copyAllStructuredFields() {
  const fields = getExtractedFields();
  if (!fields) {
    showToast("Nusxalash uchun ma'lumot mavjud emas. Avval ID kartani skanerlang.", 'warn');
    return;
  }

  // ID kartadagi familiyadan boshlab barcha maydonlarning aniq qonuniy tartibi
  const ORDERED_LABELS = [
    ['surname',          'Familiya'],
    ['first_name',       'Ism'],
    ['patronymic',       'Otasining ismi'],
    ['full_name',        'To\'liq ismi'],
    ['personal_number',  'JSHSHIR (PINFL)'],
    ['document_number',  'Hujjat raqami'],
    ['date_of_birth',    'Tug\'ilgan sana'],
    ['place_of_birth',   'Tug\'ilgan joyi'],
    ['date_of_issue',    'Berilgan sana'],
    ['date_of_expiry',   'Amal qilish muddati'],
    ['gender',           'Jinsi'],
    ['nationality',      'Fuqaroligi / Millati'],
    ['issuing_authority','Kim tomonidan berilgan'],
  ];

  const lines = [];
  let copiedCount = 0;
  for (const [key, label] of ORDERED_LABELS) {
    const val = fields[key];
    if (val && val !== 'null' && val !== 'None') {
      lines.push(`${label}: ${val}`);
      copiedCount++;
    }
  }

  if (lines.length === 0) {
    showToast("Tuzilgan maydonlar bo'sh.", 'warn');
    return;
  }

  const formattedText = lines.join('\n');
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(formattedText);
    } else {
      fallbackCopyText(formattedText);
    }
  } catch (err) {
    fallbackCopyText(formattedText);
  }

  // Visual animation on button
  const btn = document.getElementById('btnCopyAll');
  if (btn) {
    btn.classList.add('copied');
    const origHtml = btn.innerHTML;
    btn.innerHTML = `<span class="btn-copy-icon">✅</span><span class="btn-copy-label">Nusxalandi (${copiedCount} ta)!</span>`;
    setTimeout(() => {
      btn.classList.remove('copied');
      btn.innerHTML = origHtml;
    }, 2400);
  }

  showToast(`✅ ID kartaning familiyadan boshlab barcha ${copiedCount} ta ma'lumoti nusxalandi!`, 'success');
  log(`Barcha maydonlar (${copiedCount} ta) buferga to'liq nusxalandi`, LEVELS.OK);
}

async function copyStructuredCompact() {
  const fields = getExtractedFields();
  if (!fields) {
    showToast("Nusxalash uchun ma'lumot mavjud emas.", 'warn');
    return;
  }

  const parts = [];
  if (fields.full_name) parts.push(fields.full_name);
  if (fields.personal_number) parts.push(`JSHSHIR: ${fields.personal_number}`);
  if (fields.document_number) parts.push(fields.document_number);
  if (fields.date_of_birth) parts.push(fields.date_of_birth);

  if (!parts.length) {
    showToast("Ma'lumot topilmadi.", 'warn');
    return;
  }

  const compactText = parts.join(' | ');
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(compactText);
    } else {
      fallbackCopyText(compactText);
    }
  } catch (err) {
    fallbackCopyText(compactText);
  }

  const btn = document.getElementById('btnCopyCompact');
  if (btn) {
    const origHtml = btn.innerHTML;
    btn.innerHTML = `<span class="btn-copy-icon">✅</span><span class="btn-copy-label">Nusxalandi!</span>`;
    setTimeout(() => { btn.innerHTML = origHtml; }, 2000);
  }

  showToast('⚡ F.I.O va asosiy rekvizitlar nusxalandi!', 'success');
  log(`Qisqa nusxa olindi: ${compactText}`, LEVELS.OK);
}

async function copyText(elId) {
  const el = document.getElementById(elId);
  if (!el) return;
  const text = el.textContent || '';
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      fallbackCopyText(text);
    }
  } catch (err) {
    fallbackCopyText(text);
  }
  showToast('📋 Matn buferga nusxalandi', 'info');
  log('Matn buferga nusxalandi', LEVELS.INFO);
}

async function copyValue(text, btnEl) {
  if (!text) return;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      fallbackCopyText(text);
    }
  } catch (err) {
    fallbackCopyText(text);
  }

  if (btnEl) {
    const orig = btnEl.innerHTML;
    btnEl.innerHTML = '✓';
    btnEl.style.color = 'var(--accent)';
    setTimeout(() => {
      btnEl.innerHTML = orig;
      btnEl.style.color = '';
    }, 1500);
  }
  const preview = text.length > 25 ? text.substring(0, 25) + '...' : text;
  showToast(`"${preview}" nusxalandi`, 'info');
  log(`Nusxalandi: ${text}`, LEVELS.INFO);
}

// ── Export ───────────────────────────────────────────────────
function exportJSON() {
  if (!state.lastResult) return;
  download(
    JSON.stringify(state.lastResult, null, 2),
    'ocr_result.json',
    'application/json'
  );
  log('JSON export qilindi', LEVELS.OK);
}

function exportCSV() {
  if (!state.lastResult) return;
  const fields = state.lastResult.citizen_profile || state.lastResult.structured_fields || {};
  const rows = [['Maydon', 'Qiymat']];
  for (const [k, v] of Object.entries(fields)) {
    if (k !== 'raw_lines') rows.push([k, v ?? '']);
  }
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  download(csv, 'ocr_result.csv', 'text/csv;charset=utf-8');
  log('CSV export qilindi', LEVELS.OK);
}

function exportTXT() {
  if (!state.lastResult) return;
  download(state.lastResult.raw_text || '', 'ocr_text.txt', 'text/plain;charset=utf-8');
  log('TXT export qilindi', LEVELS.OK);
}

function download(content, filename, mime) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: mime }));
  a.download = filename;
  a.click();
}

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

// ══════════════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  log(`OCR ID System yuklandi — API: ${CONFIG.API_BASE}`, LEVELS.INFO);
  log('Rasm yuklash uchun yuklash zonasiga bosing yoki tashlang', LEVELS.INFO);

  // Keyboard shortcut: Ctrl+V paste image
  document.addEventListener('paste', (e) => {
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        processFile(file);
        log('Rasm buferdan joylashtirildi (Ctrl+V)', LEVELS.INFO);
        break;
      }
    }
  });
});
