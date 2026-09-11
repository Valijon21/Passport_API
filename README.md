# 🪪 O'zbekiston Hujjat OCR Tizimi

**ID karta va pasport rasmlaridan matnlarni professional darajada chiqarish tizimi**

---

## 📁 Loyha Strukturasi

```
ocr-id-system/
├── backend/
│   ├── config/
│   │   ├── settings.py       # Django sozlamalar
│   │   ├── urls.py           # Asosiy URL routing
│   │   └── wsgi.py
│   ├── ocr_api/
│   │   ├── ocr_engine.py     # ★ OCR yadro — image processing + Tesseract
│   │   ├── views.py          # API endpointlar
│   │   ├── serializers.py    # Request/Response validation
│   │   └── urls.py           # API URL routing
│   ├── manage.py
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── index.html            # ★ Asosiy UI
│   ├── style.css             # Dizayn
│   └── app.js                # ★ Frontend mantiq
├── setup.sh                  # Avtomatik o'rnatish
└── README.md
```

---

## ⚡ Tezkor O'rnatish

```bash
# 1. Reponi klonlang
git clone <repo-url>
cd ocr-id-system

# 2. Avtomatik o'rnatish (Ubuntu/Debian)
chmod +x setup.sh
./setup.sh

# 3. Serverni ishga tushiring
cd backend
source venv/bin/activate
python manage.py runserver

# 4. Frontend ni oching
# frontend/index.html ni brauzerda oching
```

---

## 📦 Qo'lda O'rnatish

### Sistem talablari (Ubuntu/Debian)

```bash
sudo apt install tesseract-ocr tesseract-ocr-uzb tesseract-ocr-rus tesseract-ocr-eng
```

### Windows

1. [Tesseract yuklab oling](https://github.com/UB-Mannheim/tesseract/wiki)
2. `.env` da `TESSERACT_CMD=C:\Program Files\Tesseract-OCR\tesseract.exe`

### Python paketlari

```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### Django sozlash

```bash
cp .env.example .env
# .env ni tahrirlang
python manage.py migrate
python manage.py runserver
```

---

## 🌐 API Endpointlar

### 1. ID Karta / Pasport OCR

```
POST /api/v1/ocr/id/
Content-Type: multipart/form-data

Params:
  image     : rasm fayl (JPEG/PNG/BMP/WEBP)
  doc_type  : id_card | passport | auto
```

**curl misoli:**
```bash
curl -X POST http://localhost:8000/api/v1/ocr/id/ \
  -F "image=@passport.jpg" \
  -F "doc_type=passport"
```

**Response:**
```json
{
  "success": true,
  "doc_type": "passport",
  "raw_text": "KARIMOV JASUR...",
  "structured_fields": {
    "document_number": "AA1234567",
    "jshshir": "12345678901234",
    "surname": "KARIMOV",
    "first_name": "JASUR",
    "patronymic": "ALIYEVICH",
    "birth_date": "1990-05-15",
    "expiry_date": "2030-05-14",
    "gender": "Erkak / Мужской",
    "nationality": "O'zbekiston"
  },
  "mrz": {
    "mrz_detected": true,
    "doc_type": "Passport (P)",
    "surname": "KARIMOV",
    "first_name": "JASUR",
    "document_number": "AA1234567",
    "birth_date": "1990-05-15"
  },
  "confidence": 87.4,
  "processing_time_ms": 1230,
  "debug": {
    "deskew_angle": -2.3,
    "ocr_source": "enhanced_gray",
    "psm_used": 6,
    "preprocess_ms": 340
  }
}
```

### 2. Umumiy Matn OCR

```
POST /api/v1/ocr/general/
Content-Type: multipart/form-data

Params:
  image : rasm fayl
```

### 3. Tizim Holati

```
GET /api/v1/health/
```

### 4. API Ma'lumoti

```
GET /api/v1/info/
```

---

## 🔧 OCR Pipeline

```
Rasm
  ↓
[Hajm kengaytirish] → min 1200px balandlik
  ↓
[Deskew] → qiyshiqlikni aniqlash va tuzatish (±45°)
  ↓
[Denoise] → shovqin filtratsiyasi (fastNlMeansDenoising)
  ↓
[CLAHE] → adaptiv kontrast kuchaytirish
  ↓
[Sharpen] → matn o'tkir qilish (unsharp masking)
  ↓
[Multi-PSM OCR] → 4 xil rejimda Tesseract (psm 3,4,6,11)
  ↓
[Best result] → eng yuqori ishonch koeffitsientli natija
  ↓
[MRZ Parser] → TD1/TD3 machine readable zone
  ↓
[Field Extraction] → regex + pattern matching
  ↓
JSON Response
```

---

## 🔗 Integratsiya

### JavaScript / Fetch

```javascript
const formData = new FormData();
formData.append('image', fileInput.files[0]);
formData.append('doc_type', 'auto');

const response = await fetch('http://localhost:8000/api/v1/ocr/id/', {
  method: 'POST',
  body: formData,
});
const data = await response.json();
console.log(data.structured_fields.document_number);
```

### Python / requests

```python
import requests

with open('passport.jpg', 'rb') as f:
    response = requests.post(
        'http://localhost:8000/api/v1/ocr/id/',
        files={'image': f},
        data={'doc_type': 'passport'}
    )

data = response.json()
print(data['structured_fields']['surname'])
print(data['confidence'])
```

### PHP / cURL

```php
$ch = curl_init('http://localhost:8000/api/v1/ocr/id/');
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, [
    'image' => new CURLFile('/path/to/id.jpg'),
    'doc_type' => 'id_card',
]);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
$result = json_decode(curl_exec($ch), true);
echo $result['structured_fields']['jshshir'];
```

---

## 📊 Debug Ma'lumotlari

Har bir javobda `debug` maydoni mavjud:

| Maydon | Tavsif |
|--------|--------|
| `deskew_angle` | Aniqlangan qiyshiqlik burchagi (daraja) |
| `ocr_source` | Qaysi preprocessed rasm ishlatildi |
| `psm_used` | Eng yaxshi PSM rejimi (3/4/6/11) |
| `preprocess_ms` | Preprocessing vaqti (ms) |
| `original_size` | Kirish rasm o'lchami |

---

## 🚨 Loglar

Backend loglar: `backend/logs/ocr_system.log`

```
[DEBUG] 2024-01-15 10:23:45 ocr_engine | Rasm kengaytirildi: 640x400 → 1920x1200
[DEBUG] 2024-01-15 10:23:45 ocr_engine | Rasm -2.30° ga tuzatildi
[INFO]  2024-01-15 10:23:46 ocr_engine | OCR natija: conf=87.4%, chars=234
[INFO]  2024-01-15 10:23:46 ocr_engine | MRZ aniqlandi va parse qilindi
```

---

## ⚙️ Production Deploy

```bash
# Gunicorn bilan ishga tushirish
pip install gunicorn
gunicorn config.wsgi:application --bind 0.0.0.0:8000 --workers 4

# Nginx konfiguratsiyasi (minimal)
# server {
#     listen 80;
#     location /api/ { proxy_pass http://127.0.0.1:8000; }
#     location / { root /path/to/frontend; }
# }
```

**Production uchun .env o'zgartiring:**
```
DEBUG=False
SECRET_KEY=<kuchli-random-kalit>
ALLOWED_HOSTS=yourdomain.com
CORS_ALLOWED_ORIGINS=https://yourdomain.com
```
