"""
Extract phrases from:
  - OPAL_spoken phrases.pdf   -> opal_spoken
  - OPAL_written phrases.pdf  -> opal_written
  - Oxford Phrase List.pdf    -> opl_level (A1/A2/B1/B2/C1)

Output: src/data/phrase-list.json
Schema:
  {
    "<phrase>": {
      "opal_spoken": true,      // optional
      "opal_written": true,     // optional
      "opl_level": "B1"         // optional, first/lowest level found
    }
  }

Phrase normalization:
  - Lowercase
  - Strip sb/sth/sb/yourself/oneself placeholders from end
  - Strip leading optional prefix "(word(s))" e.g. "(so) for example" -> "for example"
  - Expand trailing optional "(word(s))" into two entries
  - Alternative forms separated by " / " are split into individual entries
  - Leading/trailing punctuation removed
"""

import pdfplumber
import json
import re
import sys
import io
from collections import defaultdict
from typing import List, Tuple, Dict

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

# ── Column boundaries (x0) shared across all 3 PDFs ──────────────────────────
COL_BOUNDS = [0, 173, 303, 434, 600]  # 4 columns: 0-173, 173-303, 303-434, 434+

def col_of(x0: float) -> int:
    for i, bound in enumerate(COL_BOUNDS[1:], 1):
        if x0 < bound:
            return i - 1
    return len(COL_BOUNDS) - 2


# ── Phrase normalization ──────────────────────────────────────────────────────
PLACEHOLDER_TAIL_RE = re.compile(
    r'\s+(sb/yourself|sb/sth|sb|sth|yourself|oneself|doing\s+sth|to\s+do\s+sth)$',
    re.IGNORECASE
)
# Optional prefix like "(so) " or "(not only) "
OPTIONAL_PREFIX_RE = re.compile(r'^\([^)]{1,30}\)\s+')
# Optional trailing "(word)" like "as a result (of)" or "it is important (to)"
OPTIONAL_SUFFIX_RE = re.compile(r'\s+\(([^)]{1,30})\)$')
TRAILING_PUNCT = re.compile(r'[,;:\.…]+$')
# Noise phrases containing URL-like or copyright text
NOISE_RE = re.compile(
    r'(©|oxford university press|\d+\s*/\s*\d+|'
    r'a1\s+to\s+c1|750\s+common|includes\s+idioms|'
    r'this\s+list\s+gives|important\s+phrases\s+for\s+academic|'
    r'universities\s+of|research\s+council|base\s+corpus|'
    r'oxford\s+corpus|fiction\s+subcorpus|corpus\s+of\s+academic)',
    re.IGNORECASE
)


def normalize_phrase(raw: str) -> List[str]:
    """
    Normalize a raw phrase string into one or more canonical lookup keys.
    Returns [] if the phrase should be discarded.
    """
    raw = raw.strip()
    if not raw:
        return []

    # Discard noise before splitting
    if NOISE_RE.search(raw):
        return []

    # Split on " / " to handle alternate forms
    parts = [p.strip() for p in raw.split(' / ')]
    result_set = set()

    for part in parts:
        p = part.strip()
        if not p:
            continue

        # Strip leading optional prefix repeatedly: "(is) (often) referred to as" → "referred to as"
        for _ in range(4):
            new_p = OPTIONAL_PREFIX_RE.sub('', p).strip()
            if new_p == p:
                break
            p = new_p
        if not p:
            continue

        # Handle trailing optional: "as a result (of)" → "as a result" + "as a result of"
        m = OPTIONAL_SUFFIX_RE.search(p)
        if m:
            base = OPTIONAL_SUFFIX_RE.sub('', p).strip()
            extended = p[:m.start()].strip() + ' ' + m.group(1).strip()
            candidates = [base, extended]
        else:
            candidates = [p]

        for c in candidates:
            # Remove trailing placeholders repeatedly
            for _ in range(3):
                new_c = PLACEHOLDER_TAIL_RE.sub('', c).strip()
                if new_c == c:
                    break
                c = new_c
            # Remove trailing punctuation
            c = TRAILING_PUNCT.sub('', c).strip()
            c = c.lower()
            # Discard if still has unstripped parenthetical prefix
            if c.startswith('('):
                continue
            # Discard if starts with "/" (split artifact)
            if c.startswith('/'):
                continue
            # Discard if too short
            words_list = c.split()
            if len(words_list) < 2 or len(c) < 5:
                continue
            # Discard if still looks like noise
            if c.startswith('©') or re.match(r'^\d+\s*/\s*\d+$', c):
                continue
            result_set.add(c)

    return list(result_set)


# ── Section header detection (OPAL) ──────────────────────────────────────────
OPAL_SECTION_RE = re.compile(r'^\d+\.\s+')
OPAL_SKIP_RE = re.compile(
    r'(Oxford Phrasal Academic Lexicon|OPAL has been created|fiction subcorpus|'
    r'British National Corpus|British Academic Spoken|BASE was developed|'
    r'funding from BALEAP|©\s*Oxford|Spoken phrases|Written phrases|'
    r'directorship of|Warwick and|Reading under|'
    r'subset of the british|relevant permissions|paul thompson|'
    r'british academy|arts and humanities|following corpora|'
    r'within the university|spoken english.*corpus|corpus.*developed|'
    r'BALEAP|EURALEX|OCAE|OEC\)|BASE\)|'
    r'academic english \(|spoken element)',
    re.IGNORECASE
)
# OPAL content zone: skip header/intro (y < 165) and bottom copyright (y > 790)
OPAL_Y_MIN = 165.0
OPAL_Y_MAX = 790.0


def extract_opal(path: str) -> List[str]:
    """
    Extract raw phrases from an OPAL PDF using column-based splitting.
    Skips intro/header zone (y < 165) and bottom copyright (y > 790).
    Returns list of raw phrase strings.
    """
    phrases = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            words = page.extract_words(x_tolerance=5, y_tolerance=3)
            cells: Dict[Tuple, List] = defaultdict(list)
            for w in words:
                if w['top'] < OPAL_Y_MIN or w['top'] > OPAL_Y_MAX:
                    continue
                row_y = round(w['top'] / 2) * 2
                col = col_of(w['x0'])
                cells[(row_y, col)].append(w['text'])

            for (row_y, col) in sorted(cells.keys()):
                text = ' '.join(cells[(row_y, col)])
                if OPAL_SECTION_RE.match(text):
                    continue
                if OPAL_SKIP_RE.search(text):
                    continue
                if len(text) > 100:
                    continue
                phrases.append(text)
    return phrases


# ── OPL extraction ────────────────────────────────────────────────────────────
OPL_LEVEL_RE = re.compile(r'^(A1|A2|B1|B2|C1)$')
OPL_SKIP_RE = re.compile(
    r'(The Oxford Phrase List|©\s*Oxford|\d+\s*/\s*\d+|'
    r'750\s+common|includes\s+idioms|verbs,\s+compounds|'
    r'prepositional\s+phrases|other\s+common)',
    re.IGNORECASE
)
LEVEL_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1']
EXAMPLE_SENT_RE = re.compile(
    r"^(I'm|I've|I'd|I\s+[a-z]+|You're|You\s+[a-z]+|He's|She's|They're|We're|"
    r"Are\s+you|Did\s+you|Have\s+you|Is\s+it|It's|There's|That's|Tell\s+me)\b",
    re.IGNORECASE
)
# On page 1 of OPL, skip the intro paragraph (y < 135). On pages 2-4, all content valid.
OPL_PAGE1_Y_MIN = 135.0


def extract_opl(path: str) -> List[Tuple[str, str]]:
    """
    Extract (raw_phrase, level) tuples from Oxford Phrase List PDF.
    Detects CEFR level from UtopiaStd-Bold font words.
    Includes both MyriadPro-Regular and MyriadPro-Light entries.
    Level markers are never skipped by y threshold.
    """
    results = []
    current_level = 'A1'

    with pdfplumber.open(path) as pdf:
        for page_idx, page in enumerate(pdf.pages):
            words = page.extract_words(x_tolerance=5, y_tolerance=3)
            all_chars = page.chars
            is_first_page = (page_idx == 0)

            enriched = []
            for w in words:
                # On page 1, skip intro text (y < 135) for phrase content
                # but never skip potential level markers
                w_chars = [
                    c for c in all_chars
                    if c['x0'] >= w['x0'] - 1 and c['x0'] <= w['x1'] + 1
                    and c['top'] >= w['top'] - 1 and c['top'] <= w['bottom'] + 1
                ]
                fonts = set(c.get('fontname', '') for c in w_chars)
                is_level = any('UtopiaStd-Bold' in f or 'UtopiaStd-Semibold' in f for f in fonts)
                sizes = [c.get('size', 9) for c in w_chars]
                avg_size = sum(sizes) / len(sizes) if sizes else 9
                # Skip tiny text (headers/footers) unless it's a level marker
                is_skip = avg_size < 8.7 and not is_level
                # Skip page 1 intro zone for non-level content
                if is_first_page and not is_level and w['top'] < OPL_PAGE1_Y_MIN:
                    is_skip = True
                enriched.append({**w, 'is_level': is_level, 'is_skip': is_skip})

            cells: Dict[Tuple, List] = defaultdict(list)
            level_cells: Dict[Tuple, str] = {}

            for w in enriched:
                row_y = round(w['top'] / 2) * 2
                col = col_of(w['x0'])
                key = (row_y, col)
                if w['is_level']:
                    level_cells[key] = w['text']
                elif not w['is_skip']:
                    cells[key].append(w['text'])

            all_row_ys = sorted(set(k[0] for k in list(cells.keys()) + list(level_cells.keys())))
            for row_y in all_row_ys:
                for col in range(4):
                    key = (row_y, col)
                    if key in level_cells:
                        lvl = level_cells[key]
                        if OPL_LEVEL_RE.match(lvl):
                            current_level = lvl

                for col in range(4):
                    key = (row_y, col)
                    if key not in cells:
                        continue
                    text = ' '.join(cells[key])
                    if OPL_SKIP_RE.search(text):
                        continue
                    if len(text) > 100:
                        continue
                    if EXAMPLE_SENT_RE.match(text) and (
                        text.endswith('.') or text.endswith('?') or text.endswith('!')
                    ):
                        continue
                    results.append((text, current_level))

    return results


# ── Merge into phrase-list.json ───────────────────────────────────────────────
def merge_phrases(
    opal_spoken_raw: List[str],
    opal_written_raw: List[str],
    opl_raw: List[Tuple[str, str]],
) -> Dict:
    db: Dict[str, Dict] = {}

    def add(phrase: str, **flags):
        keys = normalize_phrase(phrase)
        for k in keys:
            if k not in db:
                db[k] = {}
            entry = db[k]
            for flag, val in flags.items():
                if flag == 'opl_level':
                    if 'opl_level' not in entry:
                        entry['opl_level'] = val
                    else:
                        existing_idx = LEVEL_ORDER.index(entry['opl_level']) if entry['opl_level'] in LEVEL_ORDER else 99
                        new_idx = LEVEL_ORDER.index(val) if val in LEVEL_ORDER else 99
                        if new_idx < existing_idx:
                            entry['opl_level'] = val
                else:
                    entry[flag] = val

    for p in opal_spoken_raw:
        add(p, opal_spoken=True)
    for p in opal_written_raw:
        add(p, opal_written=True)
    for (p, level) in opl_raw:
        add(p, opl_level=level)

    return db


# ── Main ──────────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    import os
    base = '../booking/CEFR'
    # Write output to WORD_CACHE_PATH if set, otherwise fall back to src/data/
    data_dir = os.environ.get('WORD_CACHE_PATH', 'src/data')
    print('Extracting OPAL spoken...')
    spoken_raw = extract_opal(f'{base}/OPAL_spoken phrases.pdf')
    print(f'  Raw entries: {len(spoken_raw)}')

    print('Extracting OPAL written...')
    written_raw = extract_opal(f'{base}/OPAL_written phrases.pdf')
    print(f'  Raw entries: {len(written_raw)}')

    print('Extracting Oxford Phrase List...')
    opl_raw = extract_opl(f'{base}/Oxford Phrase List.pdf')
    print(f'  Raw entries: {len(opl_raw)}')

    print('\nMerging...')
    db = merge_phrases(spoken_raw, written_raw, opl_raw)
    print(f'  Total unique phrases: {len(db)}')

    spoken_only = sum(1 for e in db.values() if e.get('opal_spoken') and not e.get('opal_written'))
    written_only = sum(1 for e in db.values() if e.get('opal_written') and not e.get('opal_spoken'))
    both_opal = sum(1 for e in db.values() if e.get('opal_spoken') and e.get('opal_written'))
    opl_count = sum(1 for e in db.values() if e.get('opl_level'))
    print(f'  OPAL spoken only:  {spoken_only}')
    print(f'  OPAL written only: {written_only}')
    print(f'  OPAL both:         {both_opal}')
    print(f'  OPL:               {opl_count}')
    by_level = defaultdict(int)
    for e in db.values():
        if e.get('opl_level'):
            by_level[e['opl_level']] += 1
    for lvl in LEVEL_ORDER:
        print(f'    {lvl}: {by_level[lvl]}')

    sorted_db = dict(sorted(db.items()))
    out_path = os.path.join(data_dir, 'phrase-list.json')
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(sorted_db, f, ensure_ascii=False, indent=2)
    print(f'\nWritten: {out_path}')

    print('\nSample entries:')
    samples = [
        'in terms of', 'for example', 'as a result', 'get on', 'depend on',
        'on the other hand', 'it is important to', 'it is important',
        'in order to', 'take into account', 'so for example',
        'bear in mind', 'as a result of',
    ]
    for s in samples:
        if s in sorted_db:
            print(f'  {s!r}: {sorted_db[s]}')
        else:
            print(f'  {s!r}: NOT FOUND')

    # Noise check
    print('\nFirst 10 entries (noise check):')
    for k, v in list(sorted_db.items())[:10]:
        print(f'  {k!r}: {v}')

    # Check for remaining noise patterns
    noise_found = [(k, v) for k, v in sorted_db.items()
                   if any(w in k for w in ['corpus', 'oxford phrasal', 'permission', 'british academy',
                                           'humanities research', 'warwick', 'baleap'])]
    if noise_found:
        print(f'\nRemaining noise ({len(noise_found)}):')
        for k, v in noise_found[:10]:
            print(f'  {k!r}: {v}')
    else:
        print('\nNo obvious noise remaining.')
