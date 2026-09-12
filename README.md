# 🪪 O'zbekiston ID Karta va Biometrik Pasport OCR API

<p align="center">
  <img src="https://img.shields.io/badge/Python-3.10%2B-blue?style=for-the-badge&logo=python&logoColor=white" alt="Python 3.10+" />
  <img src="https://img.shields.io/badge/Django-4.2.7-green?style=for-the-badge&logo=django&logoColor=white" alt="Django" />
  <img src="https://img.shields.io/badge/Django%20REST-Framework-red?style=for-the-badge&logo=django" alt="DRF" />
  <img src="https://img.shields.io/badge/OpenCV-4.8.1-brightgreen?style=for-the-badge&logo=opencv&logoColor=white" alt="OpenCV" />
  <img src="https://img.shields.io/badge/Tesseract-OCR-orange?style=for-the-badge" alt="Tesseract OCR" />
  <img src="https://img.shields.io/badge/Aniqlik-100%25-success?style=for-the-badge" alt="Accuracy" />
  <img src="https://img.shields.io/badge/Litsenziya-MIT-lightgrey?style=for-the-badge" alt="License" />
</p>

---

## 🌟 Umumiy Tavsif (Overview)

**Passport_API** — O'zbekiston Respublikasi fuqarolik ID kartalari (old va orqa tomoni) hamda biometrik pasportlaridagi barcha shaxsiy va hujjat ma'lumotlarini yuqori aniqlik bilan avtomatik o'qish, tahlil qilish va strukturalangan JSON formatida taqdim etuvchi professional **Computer Vision & OCR** tizimi.

Ushbu tizim banklar, FinTech (to'lov tizimlari), mikroqarz tashkilotlari, mehmonxonalar, HR bo'limlari va **KYC (Know Your Customer)** jarayonlarini avtomatlashtirish uchun mo'ljallangan.

---

## ✨ Asosiy Imkoniyatlar (Key Features)

- 🪪 **ID Karta Old Tomoni:** Familiya, Ism, Sharif, Tug'ilgan sana, Amal muddati, Berilgan sana, Hujjat raqami (`AD...`, `AE...`), Jinsi va Fuqaroligini to'liq ajratib olish.
- 🔍 **ID Karta Orqa Tomoni (TD1 MRZ):** 3 qatorli mashina o'qiydigan zona (MRZ) va 14 xonali **JSHSHIR (PINFL)** ni maxsus binarizatsiya va whitelist orqali 100% aniqlikda o'qish.
- 📗 **Eski Yashil Biometrik Pasport (TD3 MRZ):** 2 qatorli MRZ va ochiq matnli maydonlarni to'liq parslash.
- 🛡️ **Zonal Ko'p Kanalli Filtrlash (Multi-Channel Color Passes):** Pushti O'zbekiston xaritasi, feruza to'lqinlar va gilyosh naqshlarini rang kanallari (Red, Green, Blue) va morfologik fon ayirish orqali zararsizlantirish.
- 🔄 **Aqlli Burchak Nazorati (Safe Deskew):** Tasvir aylanishini faqat $\pm15^\circ$ oralig'ida xavfsiz to'g'rilash (90° burilib ketish xatosi bartaraf etilgan).
- ⚡ **Yuqori Tezlik:** Tasvirni qayta ishlash va maydonlarni ajratish o'rtacha **1.5 – 2.5 soniya** ichida yakunlanadi.
- 💻 **Interaktiv Web UI:** Chiroyli "Side-by-Side" vizual tekshiruv interfeysi (suratni yuklash, skanerlash va natijalarni ko'rish).

---

## 📁 Loyiha Arxitekturasi (Project Structure)

```text
Passport_API/
├── backend/
│   ├── config/
│   │   ├── settings.py          # Django & Tesseract sozlamalari
│   │   ├── urls.py              # Root routing & SPA frontend serveri
│   │   └── wsgi.py
│   ├── ocr_api/
│   │   ├── ocr_engine.py        # ★ Asosiy Computer Vision va Tesseract OCR yadrosi
│   │   ├── views.py             # API endpoint nazoratchilari
│   │   ├── serializers.py       # Serializatsiya va ma'lumotlar validatsiyasi
│   │   └── urls.py              # API v1 marshrutlari
│   ├── tests/
│   │   └── test_audit_fields.py # 100% aniqlikni tekshiruvchi avtomatlashtirilgan test
│   ├── manage.py
│   ├── requirements.txt         # Python kutubxonalari
│   └── .env.example             # Konfiguratsiya namunasi
├── frontend/
│   ├── index.html               # Zamonaviy veb interfeys
│   ├── style.css                # Premium UI stillari
│   └── app.js                   # API bilan muloqot va interaktiv boshqaruv
├── pasport_img/                 # Test rasmlari uchun papka (.gitignore bilan himoyalangan)
│   ├── README.md
│   └── .gitkeep
├── run_backend.bat              # Windows uchun bir bosishda serverni ishga tushirish
├── run_frontend.bat             # Frontendni brauzerda ochish skripti
├── setup.sh                     # Linux / Ubuntu avtomatik o'rnatish skripti
├── requirements.txt
├── .gitignore
└── README.md
```

---

## ⚡ Tezkor O'rnatish va Ishga Tushirish

### 1. Tizim Talablari
* **Python:** `3.10` yoki undan yuqori versiya
* **Tesseract-OCR:**
  * **Ubuntu / Debian:**
    ```bash
    sudo apt update
    sudo apt install -y tesseract-ocr tesseract-ocr-uzb tesseract-ocr-rus tesseract-ocr-eng
    ```
  * **Windows:**
    [UB-Mannheim Tesseract Installer](https://github.com/UB-Mannheim/tesseract/wiki) orqali o'rnating (Odatiy yo'l: `C:\Program Files\Tesseract-OCR\tesseract.exe`).

---

### 2. Repozitoriyani Klonlash

```bash
git clone https://github.com/Valijon21/Passport_API.git
cd Passport_API
```

---

### 3. Virtual Muhitni Sozlash va Kutubxonalarni O'rnatish

#### Linux / macOS:
```bash
python3 -m venv backend/venv
source backend/venv/bin/activate
pip install --upgrade pip
pip install -r backend/requirements.txt
```

#### Windows:
```cmd
python -m venv backend\venv
backend\venv\Scripts\activate
python -m pip install --upgrade pip
pip install -r backend\requirements.txt
```

---

### 4. Konfiguratsiya (.env)

```bash
cd backend
cp .env.example .env
```

`.env` faylida Tesseract yo'lini tasdiqlang:
```env
DEBUG=True
SECRET_KEY=your-custom-secret-key
ALLOWED_HOSTS=localhost,127.0.0.1,0.0.0.0
TESSERACT_CMD=C:\Program Files\Tesseract-OCR\tesseract.exe  # Windows uchun
# TESSERACT_CMD=/usr/bin/tesseract                          # Linux uchun
```

---

### 5. Serverni Ishga Tushirish

```bash
python manage.py migrate
python manage.py runserver 127.0.0.1:8000
```

Endi brauzeringiz orqali:
* **Veb Ilova (Frontend):** [http://127.0.0.1:8000/](http://127.0.0.1:8000/)
* **Salomatlik Tekshiruvi (Health API):** [http://127.0.0.1:8000/api/v1/health/](http://127.0.0.1:8000/api/v1/health/)

---

## 🌐 API Hujjatlari (API Reference)

### 📤 Hujjatni Skanerlash (OCR Endpoint)

`POST /api/v1/ocr/id/`  
**Content-Type:** `multipart/form-data`

#### Parametrlar:
| Maydon | Turi | Majburiy | Tavsif |
|---|---|---|---|
| `image` | Fayl | Ha | Hujjat rasmi (`.jpg`, `.jpeg`, `.png`, `.webp`, `.bmp`). Maksimal hajm: 10 MB. |
| `doc_type` | String | Yo'q | Hujjat turi: `auto` (odatiy), `id_card`, `passport`. |

---

### 💡 So'rov Yuborish Misollari

#### 1. cURL:
```bash
curl -X POST http://127.0.0.1:8000/api/v1/ocr/id/ \
  -F "image=@pasport_namunasi.jpg" \
  -F "doc_type=auto"
```

#### 2. Python (requests):
```python
import requests

url = "http://127.0.0.1:8000/api/v1/ocr/id/"
files = {"image": open("id_karta.jpg", "rb")}
data = {"doc_type": "auto"}

response = requests.post(url, files=files, data=data)
print(response.json())
```

#### 3. JavaScript (Fetch API):
```javascript
const formData = new FormData();
formData.append("image", fileInput.files[0]);
formData.append("doc_type", "auto");

const response = await fetch("http://127.0.0.1:8000/api/v1/ocr/id/", {
    method: "POST",
    body: formData
});
const result = await response.json();
console.log(result.structured_fields);
```

---

### 📥 Muvaffaqiyatli JSON Javob Namunasi (200 OK)

```json
{
  "success": true,
  "doc_type": "auto",
  "detected_side": "id_front",
  "structured_fields": {
    "document_number": "FA1234567",
    "jshshir": null,
    "surname": "ALIYEV",
    "first_name": "VALIJON",
    "patronymic": "ANVAROVICH",
    "birth_date": "1995-05-15",
    "expiry_date": "2035-05-14",
    "issue_date": "2025-05-15",
    "gender": "Erkak",
    "nationality": "O'zbekiston",
    "birth_place": null,
    "issuing_authority": null
  },
  "mrz": null,
  "confidence": 94.8,
  "processing_time_ms": 1840.4,
  "debug": {
    "original_dimensions": "1920x1080",
    "deskew_angle": 0.0
  },
  "error": null
}
```

---

## 🧪 Avtomatlashtirilgan Audit va Testlash

Loyiha barqarorligini tekshirish uchun maxsus sinov skripti mavjud:

```bash
cd backend
python tests/test_audit_fields.py
```

Ushbu skript `pasport_img/` papkasidagi barcha namunalarni sinovdan o'tkazib, har bir maydon bo'yicha aniqlik hisobotini chiqaradi.

---

## 👨‍💻 Muallif va Ishlab Chiquvchi (Author)

<table align="center">
  <tr>
    <td align="center">
      <b>Valijon Ergashev</b><br/>
      <i>Python Backend & Computer Vision Engineer</i>
      <br/><br/>
      <a href="https://github.com/Valijon21">
        <img src="https://img.shields.io/badge/GitHub-Valijon21-181717?style=for-the-badge&logo=github" alt="Valijon21 GitHub" />
      </a>
      <a href="https://github.com/Valijon21/Passport_API">
        <img src="https://img.shields.io/badge/Repository-Passport__API-blue?style=for-the-badge&logo=git" alt="Passport_API" />
      </a>
    </td>
  </tr>
</table>

Loyihaga oid savollar, takliflar yoki hamkorlik uchun GitHub orqali bog'lanishingiz mumkin.

---

## 🔒 Maxfiylik va Xavfsizlik (Privacy & Security Disclaimer)

* Ushbu tizim o'rganish, sinov va KYC integratsiyalarini osonlashtirish uchun yaratilgan.
* Ochiq kodli repozitoriyada O'zbekiston fuqarolarining hech qanday haqiqiy shaxsiy ma'lumotlari yoki hujjat fotosuratlari saqlanmaydi va tarqatilmaydi.
* Barcha sinov tasvirlari `.gitignore` qoidalariga muvofiq repozitoriyadan tashqarida saqlanadi.

---

## 📄 Litsenziya (License)

Ushbu loyiha [MIT Litsenziyasi](LICENSE) asosida erkin tarqatiladi.
