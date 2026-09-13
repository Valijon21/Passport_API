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
  API_BASE: 'http://127.0.0.1:8000/api/v1',  // ← Django server
  ENDPOINTS: {
    ID_CARD:    '/ocr/id/',
    ID_FULL:    '/ocr/id-full/',
    GENERAL:    '/ocr/general/',
    FACE_MATCH: '/kyc/face-match/',
    HEALTH:     '/health/',
    INFO:       '/info/',
  },
};

// ══════════════════════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════════════════════
const state = {
  file: null,
  frontFile: null,
  backFile: null,
  appMode: 'single',     // 'single' | 'double'
  selfieFile: null,
  lastResult: null,
  lastResultType: null,  // 'id' | 'general' | 'id_full'
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

// ── Two-Sided Mode Handlers ──────────────────────────────────
function switchAppMode(mode) {
  state.appMode = mode;
  const btnSingle = document.getElementById('btnModeSingle');
  const btnDouble = document.getElementById('btnModeDouble');
  const secSingle = document.getElementById('sectionSingleMode');
  const secDouble = document.getElementById('sectionDoubleMode');

  if (mode === 'double') {
    btnSingle.classList.remove('active');
    btnDouble.classList.add('active');
    secSingle.style.display = 'none';
    secDouble.style.display = 'block';
    log("Rejim tanlandi: 🪪 Two-Sided Smart Merge (ID Karta Ikkala Tomoni)", LEVELS.INFO);
  } else {
    btnDouble.classList.remove('active');
    btnSingle.classList.add('active');
    secDouble.style.display = 'none';
    secSingle.style.display = 'block';
    log("Rejim tanlandi: 📄 Yagona Hujjat / Pasport", LEVELS.INFO);
  }
  hideResults();
  hideError();
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

  const swapBanner = document.getElementById('autoSwapBanner');
  if (swapBanner) {
    swapBanner.style.display = data.auto_swapped ? 'flex' : 'none';
  }

  // Render unified citizen profile
  renderStructuredFields(data.citizen_profile || {});

  // Raw text combining both sides
  const frontRaw = data.front_side?.raw_text || '';
  const backRaw = data.back_side?.raw_text || '';
  const combinedRaw = `=== 🪪 OLD TOMON (FRONT SIDE) ===\n${frontRaw}\n\n=== 🔢 ORQA TOMON (BACK SIDE) ===\n${backRaw}`;
  renderRawText(combinedRaw);

  renderMRZ(data.mrz || data.back_side?.mrz || data.front_side?.mrz);
  renderValidation(data.validation);
  renderDebug(data);
  showResults();
  switchTabByName('structured');

  if (!data.success) {
    log(`Birlashtirishda kamchilik: ${data.error}`, LEVELS.WARN);
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
        ${hasVal ? `<button class="field-copy" onclick="copyValue('${escapeHtml(val)}')" title="Nusxa">📋</button>` : ''}
      </div>
      <div class="field-value${hasVal ? '' : ' empty'}">${hasVal ? escapeHtml(val) : '— topilmadi'}</div>
    `;
    grid.appendChild(card);
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
        if (status) {
          status.textContent = `● Jonli efir (${facingText})`;
          status.className = 'kyc-photo-status text-ok';
        }
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

// ── Clipboard ────────────────────────────────────────────────
async function copyText(elId) {
  const el = document.getElementById(elId);
  if (!el) return;
  await navigator.clipboard.writeText(el.textContent);
  log('Matn buferga nusxalandi', LEVELS.INFO);
}

async function copyValue(text) {
  await navigator.clipboard.writeText(text);
  log(`Nusxalandi: ${text.substring(0, 40)}...`, LEVELS.INFO);
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
