---
type: project
created: 2026-05-25
updated: 2026-09-15
---

# Project Conventions

## Git Workflow
- Always create a new dedicated branch for major code changes, or maintain clean conventional commits on `main` when working directly.
- Branch name format should follow: `feature/[task-slug]` or `fix/[bug-slug]`.

## ID Card & Passport OCR System Conventions
- **Canonical Citizen Profile (13 Fields)**: Both Backend (`ocr_engine.py`) and Frontend (`app.js`) must adhere to the 13 canonical fields:
  1. `full_name` (TO'LIQ ISMI)
  2. `surname` (FAMILIYA)
  3. `given_name` (ISM)
  4. `patronymic` (OTASINING ISMI)
  5. `personal_number` (JSHSHIR / PINFL)
  6. `document_number` (HUJJAT RAQAMI)
  7. `date_of_birth` (TUG'ILGAN SANA)
  8. `place_of_birth` (TUG'ILGAN JOYI)
  9. `date_of_issue` (BERILGAN SANA)
  10. `date_of_expiry` (AMAL QILISH MUDDATI)
  11. `gender` (JINSI)
  12. `nationality` (FUQAROLIGI / MILLATI)
  13. `issuing_authority` (KIM TOMONIDAN BERILGAN)
- **Unified UI Grid**: Single Document mode, Two-sided Merge mode, and Passport scans must render all 13 canonical cards in the exact same order. Missing fields must render an unobtrusive empty state (`— topilmadi`) to preserve the 3-column grid alignment without shifting or collapsing.
- **Bulk Action Buttons**: Always provide prominent "📋 Barchasini nusxalash" and "⚡ F.I.O + JSHSHIR + Hujjat raqami" copy buttons above structured results.
- **Dual-Side Single Image**: When a single image contains both sides of an ID card (A4 scan or photo of both sides), backend must detect `id_both_sides`, extract both front panel and back MRZ, and prevent `patronymic` from being wiped out.
- **PINFL Fallback**: If OCR fails on birth date, derive it mathematically from the 14-digit PINFL.

## Supported AI platforms (AG Kit)
- AG Kit **only supports Gemini CLI and Google Antigravity**.
- Do not claim compatibility with Claude Code, Cursor, Copilot, Windsurf, or other assistants unless the user explicitly expands scope.
- Copy on the website, docs, FAQ, README, and marketing should describe AG Kit as a toolkit for Gemini CLI / Antigravity-style agent setups.

