"""
Inspect structure of OPAL and Oxford Phrase List PDFs.
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
    print(f'  {label}: {fpath}')
    print('='*60)
    try:
        with pdfplumber.open(fpath) as pdf:
            print(f'  Total pages: {len(pdf.pages)}')
            for i in range(min(4, len(pdf.pages))):
                text = pdf.pages[i].extract_text() or ''
                print(f'\n  --- Page {i+1} ---')
                lines = text.splitlines()
                for ln in lines[:60]:
                    print(f'    {repr(ln)}')
    except Exception as e:
        print(f'  ERROR: {e}')
