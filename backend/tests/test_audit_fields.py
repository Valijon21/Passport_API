import os
import sys
import django
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from ocr_api.ocr_engine import extract_id_card

IMG_DIR = Path(r"D:\Proyekt\idcard2\pasport_img")
images = sorted(list(IMG_DIR.glob("*.*")))

for p in images:
    if p.suffix.lower() not in ['.jpg', '.jpeg', '.png', '.webp']:
        continue
    with open(p, 'rb') as f:
        bytes_data = f.read()
    res = extract_id_card(bytes_data)
    sf = res.get('structured_fields', {})
    side = res.get('detected_side')
    mrz_status = bool(res.get('mrz'))
    print(f"\n=======================================================")
    print(f"FILE: {p.name} | Detected: {side} | MRZ: {mrz_status}")
    print(f"=======================================================")
    for k in ['document_number', 'jshshir', 'surname', 'first_name', 'patronymic',
              'birth_date', 'expiry_date', 'issue_date', 'gender', 'nationality',
              'birth_place', 'issuing_authority']:
        v = sf.get(k)
        icon = "✅" if v else "❌"
        print(f"  {icon} {k:18}: {v}")
