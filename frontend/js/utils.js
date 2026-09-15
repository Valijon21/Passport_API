/**
 * utils.js — String Formatting, Logging, and File Exports
 */
'use strict';

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

