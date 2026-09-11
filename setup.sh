#!/bin/bash
# ══════════════════════════════════════════════════════
#  OCR ID System — O'rnatish skripti (Ubuntu/Debian)
# ══════════════════════════════════════════════════════
set -e

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║   O'zbekiston Hujjat OCR — O'rnatish        ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ── 1. Tesseract va til paketlari ──────────────────────────
echo "[1/4] Tesseract o'rnatilmoqda..."
sudo apt-get update -q
sudo apt-get install -y \
    tesseract-ocr \
    tesseract-ocr-uzb \
    tesseract-ocr-rus \
    tesseract-ocr-eng \
    libgl1-mesa-glx \
    libglib2.0-0

echo "      Tesseract versiyasi: $(tesseract --version 2>&1 | head -1)"
echo "      O'rnatilgan tillar: $(tesseract --list-langs 2>&1 | tail -n +2 | tr '\n' ' ')"

# ── 2. Python virtual environment ──────────────────────────
echo ""
echo "[2/4] Python muhiti yaratilmoqda..."
cd "$(dirname "$0")/backend"

python3 -m venv venv
source venv/bin/activate

pip install --upgrade pip -q
pip install -r requirements.txt -q

# ── 3. .env fayl ───────────────────────────────────────────
echo ""
echo "[3/4] Konfiguratsiya..."
if [ ! -f .env ]; then
    cp .env.example .env
    # Generate random secret key
    SECRET=$(python3 -c "import secrets; print(secrets.token_hex(32))")
    sed -i "s/your-secret-key-change-this-to-random-string/$SECRET/" .env
    echo "      .env fayl yaratildi"
else
    echo "      .env fayl mavjud (o'tkazib yuborildi)"
fi

# ── 4. Django migrations ───────────────────────────────────
echo ""
echo "[4/4] Django migratsiyalari..."
mkdir -p logs
python manage.py migrate --run-syncdb -v 0

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║   ✅ O'rnatish muvaffaqiyatli tugadi!        ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
echo "  🚀 Serverni ishga tushirish:"
echo "     cd backend"
echo "     source venv/bin/activate"
echo "     python manage.py runserver"
echo ""
echo "  🌐 Frontend:"
echo "     frontend/index.html ni brauzerda oching"
echo "     yoki: python3 -m http.server 5500 (frontend papkasida)"
echo ""
echo "  📋 API holati:"
echo "     http://127.0.0.1:8000/api/v1/health/"
echo "     http://127.0.0.1:8000/api/v1/info/"
echo ""
