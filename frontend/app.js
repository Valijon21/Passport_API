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
    ID_CARD:  '/ocr/id/',
    GENERAL:  '/ocr/general/',
    HEALTH:   '/health/',
    INFO:     '/info/',
  },
};

// ══════════════════════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════════════════════
const state = {
  file: null,
  lastResult: null,
  lastResultType: null,  // 'id' | 'general'
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
  log('Tozalandi', LEVELS.INFO);
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
  renderConfidence(data.confidence, data.processing_time_ms);
  renderStructuredFields(data.structured_fields || {});
  renderRawText(data.raw_text || '');
  renderMRZ(data.mrz);
  renderDebug(data);
  showResults();

  if (!data.success) {
    log(`OCR muvaffaqiyatsiz: ${data.error}`, LEVELS.WARN);
  }
}

function renderGeneralResult(data) {
  // For general OCR, show in raw text tab, hide structured
  renderConfidence(data.confidence, data.processing_time_ms);

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

const FIELD_LABELS = {
  document_number:  { label: 'Hujjat raqami', icon: '🪪' },
  jshshir:          { label: 'JSHSHIR / INN', icon: '🔢' },
  surname:          { label: 'Familiya',       icon: '👤' },
  first_name:       { label: 'Ism',            icon: '👤' },
  patronymic:       { label: 'Otasining ismi', icon: '👤' },
  birth_date:       { label: 'Tug\'ilgan sana', icon: '📅' },
  issue_date:       { label: 'Berilgan sana',  icon: '📅' },
  expiry_date:      { label: 'Amal qilish muddati', icon: '📅' },
  gender:           { label: 'Jinsi',          icon: '⚧' },
  nationality:      { label: 'Millati',        icon: '🌍' },
  birth_place:      { label: 'Tug\'ilgan joyi', icon: '📍' },
  issuing_authority:{ label: 'Bergan organ',   icon: '🏛' },
};

function renderStructuredFields(fields) {
  const grid = document.getElementById('fieldsGrid');
  grid.innerHTML = '';

  const keys = Object.keys(FIELD_LABELS);
  let foundCount = 0;

  for (const key of keys) {
    const meta = FIELD_LABELS[key];
    const val = fields[key];
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

  log(`Tuzilgan maydonlar: ${foundCount}/${keys.length} topildi`, foundCount > 0 ? LEVELS.OK : LEVELS.WARN);
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
  document.getElementById('tab-' + name).classList.add('active');
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
  const fields = state.lastResult.structured_fields || {};
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
