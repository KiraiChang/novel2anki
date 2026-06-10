"""
Inspect font/style info in OPL PDF to detect example sentences.
"""
import pdfplumber
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

with pdfplumber.open('../booking/CEFR/Oxford Phrase List.pdf') as pdf:
    page = pdf.pages[1]  # page 2 has clear examples
    chars = page.chars
    # Group chars by fontname
    fonts = {}
    for c in chars[:300]:
        fn = c.get('fontname', '')
        sz = c.get('size', 0)
        key = f'{fn}|sz={sz:.1f}'
        if key not in fonts:
            fonts[key] = []
        fonts[key].append(c['text'])

    print('Font groups:')
    for k, chars_list in sorted(fonts.items()):
        sample = ''.join(chars_list[:40])
        print(f'  {k}: {repr(sample)}')

    print('\n\nSample rows with font info:')
    # Extract words with font tags
    words = page.extract_words(x_tolerance=5, y_tolerance=3)
    # For each word, get the dominant font from chars at that position
    word_fonts = []
    for w in words[:80]:
        wchars = [c for c in page.chars
                  if c['x0'] >= w['x0']-1 and c['x0'] <= w['x1']+1
                  and c['top'] >= w['top']-1 and c['top'] <= w['bottom']+1]
        font_set = set(c.get('fontname','') for c in wchars)
        word_fonts.append((w['x0'], w['top'], w['text'], font_set))

    for x, y, text, fset in word_fonts:
        print(f'  x={x:6.1f} y={y:6.1f} text={text:<25} fonts={fset}')
