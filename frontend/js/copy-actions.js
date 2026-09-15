/**
 * copy-actions.js — Toast Notifications, Bulk Copy, Document Copy and Single Field Copy
 */
'use strict';

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
  return normalizeCitizenFields(raw);
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
    showToast("Nusxalash uchun ma'lumot mavjud emas. Avval ID kartani skanerlang.", 'warn');
    return;
  }

  const parts = [];
  if (fields.full_name) parts.push(fields.full_name);
  if (fields.personal_number) parts.push(`JSHSHIR: ${fields.personal_number}`);

  if (!parts.length) {
    showToast("F.I.O va JSHSHIR maydonlari topilmadi.", 'warn');
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
    btn.classList.add('copied');
    const origHtml = btn.innerHTML;
    btn.innerHTML = `<span class="btn-copy-icon">✅</span><span class="btn-copy-label">Nusxalandi!</span>`;
    setTimeout(() => {
      btn.classList.remove('copied');
      btn.innerHTML = origHtml;
    }, 2200);
  }

  showToast('⚡ F.I.O va JSHSHIR nusxalandi!', 'success');
  log(`F.I.O va JSHSHIR nusxalandi: ${compactText}`, LEVELS.OK);
}

async function copyStructuredDoc() {
  const fields = getExtractedFields();
  if (!fields) {
    showToast("Nusxalash uchun ma'lumot mavjud emas. Avval ID kartani skanerlang.", 'warn');
    return;
  }

  const parts = [];
  if (fields.full_name) parts.push(fields.full_name);
  if (fields.personal_number) parts.push(`JSHSHIR: ${fields.personal_number}`);
  if (fields.document_number) parts.push(`Hujjat: ${fields.document_number}`);

  if (!parts.length) {
    showToast("Asosiy rekvizitlar topilmadi.", 'warn');
    return;
  }

  const docText = parts.join(' | ');
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(docText);
    } else {
      fallbackCopyText(docText);
    }
  } catch (err) {
    fallbackCopyText(docText);
  }

  const btn = document.getElementById('btnCopyDoc');
  if (btn) {
    btn.classList.add('copied');
    const origHtml = btn.innerHTML;
    btn.innerHTML = `<span class="btn-copy-icon">✅</span><span class="btn-copy-label">Nusxalandi!</span>`;
    setTimeout(() => {
      btn.classList.remove('copied');
      btn.innerHTML = origHtml;
    }, 2200);
  }

  showToast('🪪 F.I.O, JSHSHIR va Hujjat raqami nusxalandi!', 'success');
  log(`F.I.O, JSHSHIR va Hujjat raqami nusxalandi: ${docText}`, LEVELS.OK);
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

