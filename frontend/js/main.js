/**
 * main.js — Application Bootstrap and Initialization
 */
'use strict';

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
