---
type: project
created: 2026-07-18
updated: 2026-09-15
---

# Technical Decisions

- Component metadata uses SemVer while the toolkit release keeps CalVer.
- `manifest.json` and `manifest.lock.json` must remain synchronized with component frontmatter.
- **OCR Citizen Profile Unification**: `extract_id_card()` returns both legacy `structured_fields` (for backward compatibility) and `citizen_profile` (strictly structured 13 keys). Frontend `normalizeCitizenFields()` handles aliases, full name formatting, and gender inference.
- **Dual-Side Image Detection**: Aspect ratio analysis (`h > 0.82 * w` vertical, or horizontal split) triggers dual-half cropping to detect both front panel and back MRZ in a single document scan.
- **Patronymic Protection**: `_extract_id_front_panel()` is executed regardless of MRZ presence, ensuring patronymic is retained when front indicators (`SURNAME`, `GIVEN SURNAME`, `OTASINING ISMI`) are detected.
- **PINFL Birth Date Extraction**: Century code (1-6) + YYMMDD is parsed from PINFL when raw OCR date text is unreadable or obscured.
- **Cache Invalidation**: Query param `?v=X.Y.Z` on script tags in `index.html` prevents stale browser caching of frontend modules during development and deployment.

