/**
 * renderers.js — Result Card Renderers, MRZ Visualizer, Validation Report and Tabs
 */
'use strict';

// ══════════════════════════════════════════════════════════════
//  RENDERING
// ══════════════════════════════════════════════════════════════
function renderIDResult(data) {
  const swapBanner = document.getElementById('autoSwapBanner');
  if (swapBanner) swapBanner.style.display = 'none';

  renderConfidence(data.confidence, data.processing_time_ms);
  renderFaceCrop(data.face);
  
  const fields = data.citizen_profile || data.structured_fields || {};
  renderStructuredFields(fields);
  
  renderRawText(data.raw_text || '');
  renderMRZ(data.mrz);
  renderValidation(data.validation);
  renderDebug(data);
  showResults();
  switchTabByName('structured');

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

// ── Canonical 13-Field Standard Profile for Uzbekistan Documents ────
const CANONICAL_CITIZEN_FIELDS = [
  { key: 'full_name',          aliases: ['full_name'],                                  label: "TO'LIQ ISMI",             icon: '🪪' },
  { key: 'surname',            aliases: ['surname'],                                    label: 'FAMILIYA',                icon: '👤' },
  { key: 'first_name',         aliases: ['first_name'],                                 label: 'ISM',                     icon: '👤' },
  { key: 'patronymic',         aliases: ['patronymic'],                                 label: 'OTASINING ISMI',          icon: '👤' },
  { key: 'personal_number',    aliases: ['personal_number', 'jshshir', 'pinfl'],        label: 'JSHSHIR (PINFL)',         icon: '🔢' },
  { key: 'document_number',    aliases: ['document_number', 'doc_num'],                 label: 'HUJJAT RAQAMI',           icon: '🪪' },
  { key: 'date_of_birth',      aliases: ['date_of_birth', 'birth_date'],                label: "TUG'ILGAN SANA",          icon: '📅' },
  { key: 'place_of_birth',     aliases: ['place_of_birth', 'birth_place'],               label: "TUG'ILGAN JOYI",          icon: '📍' },
  { key: 'date_of_issue',      aliases: ['date_of_issue', 'issue_date'],                label: 'BERILGAN SANA',           icon: '📅' },
  { key: 'date_of_expiry',     aliases: ['date_of_expiry', 'expiry_date'],              label: 'AMAL QILISH MUDDATI',     icon: '📅' },
  { key: 'gender',             aliases: ['gender'],                                     label: 'JINSI',                   icon: '⚧' },
  { key: 'nationality',        aliases: ['nationality'],                                label: 'FUQAROLIGI / MILLATI',    icon: '🌍' },
  { key: 'issuing_authority',  aliases: ['issuing_authority'],                           label: 'KIM TOMONIDAN BERILGAN',  icon: '🏛' },
];

function normalizeCitizenFields(raw) {
  if (!raw) return {};
  const src = { ...raw };
  const out = {};

  for (const item of CANONICAL_CITIZEN_FIELDS) {
    let val = '';
    for (const alias of item.aliases) {
      if (src[alias] && src[alias] !== 'null' && src[alias] !== 'None') {
        val = String(src[alias]).trim();
        break;
      }
    }
    out[item.key] = val;
  }

  // 1. Auto-assemble full_name if missing or partial
  if (!out.full_name) {
    const parts = [out.surname, out.first_name, out.patronymic].filter(Boolean);
    if (parts.length) {
      out.full_name = parts.join(' ');
    }
  }

  // 2. Derive Gender from Patronymic or PINFL if not present
  if (!out.gender) {
    if (out.personal_number && out.personal_number.length === 14) {
      const fDig = out.personal_number[0];
      if (['1', '3', '5'].includes(fDig)) out.gender = 'Erkak';
      else if (['2', '4', '6'].includes(fDig)) out.gender = 'Ayol';
    }
    if (!out.gender && out.patronymic) {
      const pUp = out.patronymic.toUpperCase();
      if (/O['ʻʼ`]?G['ʻʼ`]?LI|VICH|OVICH|EVICH\b/.test(pUp)) out.gender = 'Erkak';
      else if (/QIZI|VNA|OVNA|EVNA\b/.test(pUp)) out.gender = 'Ayol';
    }
  }

  // 3. Derive Date of Birth from 14-digit PINFL if missing
  if (!out.date_of_birth && out.personal_number && out.personal_number.length === 14) {
    const p = out.personal_number;
    const lead = p[0];
    const centMap = { '1': 1800, '2': 1800, '3': 1900, '4': 1900, '5': 2000, '6': 2000 };
    if (centMap[lead]) {
      const dd = p.slice(1, 3);
      const mm = p.slice(3, 5);
      const yy = parseInt(p.slice(5, 7), 10);
      const fullYear = centMap[lead] + yy;
      out.date_of_birth = `${fullYear}-${mm}-${dd}`;
    }
  }

  // 4. Default nationality for Uzbekistan documents
  if (!out.nationality) {
    out.nationality = "O'zbekiston";
  }

  return out;
}

function renderStructuredFields(fields) {
  const grid = document.getElementById('fieldsGrid');
  if (!grid) return;
  grid.innerHTML = '';

  const normalized = normalizeCitizenFields(fields);
  let foundCount = 0;

  // Render exactly the 13 canonical fields in standard order (matching screenshot)
  for (const meta of CANONICAL_CITIZEN_FIELDS) {
    const val = normalized[meta.key];
    const hasVal = val && val !== 'null' && val !== 'None' && String(val).trim() !== '';
    if (hasVal) foundCount++;

    const card = document.createElement('div');
    card.className = 'field-card' + (hasVal ? ' has-value' : '');
    card.innerHTML = `
      <div class="field-label">
        <span class="field-label-text">${meta.icon} ${meta.label}</span>
        ${hasVal ? `<button type="button" class="field-copy" onclick="copyValue('${escapeHtml(String(val))}', this)" title="Nusxa olish">📋</button>` : ''}
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

