# Loyiha Optimallashtirish va Sifat Rejasi (Zero-Bloat, Lean & Clean)

## Maqsad
Serverga **hech qanday tashqi og'ir narsa (Redis, Celery, PyTorch, MediaPipe) qo'shmasdan**, mavjud resurslarni maksimal darajada yengillashtirish, xotirani tejash va OCR aniqligini 100% ga yetkazish.

---

## 1. Nimalar Butunlay Olib Tashlandi (Rad Etildi):
- ❌ **Redis va Celery** — ortiqcha xizmatlar, 200MB+ qo'shimcha RAM talab qilgani uchun butunlay olib tashlandi.
- ❌ **Yangi og'ir kutubxonalar (PyTorch, MediaPipe, Deep Learning)** — 1GB+ xotira yeyishi va serverni qotirishi xavfi borligi uchun rad etildi.
- ❌ **Ortiqcha me'moriy qatlamlar** — tizim bitta `run_backend.bat` bilan mustaqil va yengil ishlashda davom etadi.

---

## 2. Amalga Oshiriladigan Professional va Yengil Qismlar:

### 1-bosqich: Server RAM va Tezlikni Optimallashtirish (Memory Shield)
- **Muammo:** Foydalanuvchi telefonidan 15-20 MB li ulkan rasm yuklasa, OpenCV xotirasida 100MB+ joy oladi va OCR 15 soniyagacha cho'ziladi.
- **Yechim:** Rasm yuklanganda uni sifatini yo'qotmasdan optimal o'lchamga (max 1920-2048px) xavfsiz masshtablash (Downscale). Bu RAM sarfini 60% tejaydi va ishlov berish vaqtini 2 barobar tezlashtiradi!

### 2-bosqich: OCR va Toponimlar Aniqligini Mustahkamlash (Zero-Error)
- O'zbekiston ID kartalari va pasportlaridagi optik chalkashliklarni (familiya oraliqlari, Pop, Chust, viloyat nomlari) 100% ishonchli qilish.
- Barcha 42 ta integratsion va modulli testlarning to'liq va tezkor o'tishini ta'minlash.

### 3-bosqich: Frontend Xotira Oqishi (Memory Leak) Tozalovi
- Brauzerda Smart Camera ochilib yopilganda WebRTC kamera oqimlarini (`stream.getTracks().forEach(t => t.stop())`) to'liq tozalash.
- Sahifani yengil va tezkor saqlash.

### 4-bosqich: Qonuniy Muvofiqlik va Loglarni Maskalash (O'RQ-547)
- Server loglariga shaxsiy ma'lumotlar (JSHSHIR va pasport raqami) ochiq tushishini oldini oluvchi yengil sanitizer.
