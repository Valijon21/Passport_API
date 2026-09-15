/**
 * file-handlers.js — Drag-and-drop, File Input, Image Preview and Mode Switching
 */
'use strict';

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

