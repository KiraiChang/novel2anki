"""
Inspect column layout of phrase PDFs using word coordinates.
"""
import pdfplumber
import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

FILES = [
    ('../booking/CEFR/OPAL_spoken phrases.pdf', 'OPAL_spoken'),
    ('../booking/CEFR/OPAL_written phrases.pdf', 'OPAL_written'),
    ('../booking/CEFR/Oxford Phrase List.pdf', 'OPL'),
]

for fpath, label in FILES:
    print(f'\n{"="*60}')
    print(f'  {label}')
    print('='*60)
    with pdfplumber.open(fpath) as pdf:
        page = pdf.pages[0]
        print(f'  Page size: {page.width:.0f} x {page.height:.0f}')
        words = page.extract_words(x_tolerance=5, y_tolerance=3)
        # Show first 80 words with coordinates
        for w in words[:80]:
            print(f'  x0={w["x0"]:6.1f}  y={w["top"]:6.1f}  text={repr(w["text"])}')
