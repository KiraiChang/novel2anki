#!/usr/bin/env python3
"""
解析 American Oxford 5000 PDF → word:level JSON

用法：
  pip install pdfplumber
  python3 scripts/extract-oxford-american.py \
    --input "../booking/CEFR/American_Oxford_5000_by_CEFR_level.pdf" \
    --output scripts/oxford-american-b2c1.json
"""

import re
import json
import sys
import argparse

VALID_LEVELS = {'B2', 'C1'}
LEVEL_HEADER = re.compile(r'^(A1|A2|B1|B2|C1|C2)$')

# 比對行內所有「word pos.」模式（含括號消歧、同音異義編號）
# 例：absorb v.  |  counter (long flat surface) n.  |  bass1 n.  |  bow1 v., n.
WORD_POS_RE = re.compile(
    r'\b([a-z][a-z\-]*\d*)'           # 詞（可含尾綴數字）
    r'(?:\s*\([^)]+\))?'              # 可選括號消歧
    r'\s+'                             # 空白
    r'(?:n|v|adj|adv|prep|pron|conj|number)'  # POS
    r'[\s.,/]',                        # POS 結尾標點
    re.IGNORECASE
)
TRAILING_DIGIT = re.compile(r'\d+$')

SKIP_PHRASES = [
    '© Oxford', 'Oxford University Press',
    'The Oxford 5000', 'CEFR level', 'American English',
    'expanded core word', 'additional 2000',
]


def extract_tokens(line: str):
    """從單行文字中提取所有合法單字。"""
    words = []
    for m in WORD_POS_RE.finditer(line):
        raw = m.group(1)
        word = TRAILING_DIGIT.sub('', raw).lower().strip()
        if re.match(r'^[a-z][a-z\-]*$', word):
            words.append(word)
    return words


def extract_words(pdf_path: str) -> dict:
    try:
        import pdfplumber
    except ImportError:
        print('請先安裝 pdfplumber：pip install pdfplumber', file=sys.stderr)
        sys.exit(1)

    result: dict = {}
    current_level = None

    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text(layout=False) or ''
            for raw_line in text.splitlines():
                line = raw_line.strip()
                if not line:
                    continue

                # 偵測等級標頭
                if LEVEL_HEADER.match(line):
                    if line in VALID_LEVELS:
                        current_level = line
                    continue

                # 跳過版權、標題行
                if any(skip in line for skip in SKIP_PHRASES):
                    continue

                if current_level not in VALID_LEVELS:
                    continue

                # 從行內提取所有 word+POS 組合（處理多欄合併行）
                for word in extract_tokens(line):
                    if word not in result:
                        result[word] = current_level

    return dict(sorted(result.items()))


def main():
    parser = argparse.ArgumentParser(description='解析 American Oxford 5000 PDF')
    parser.add_argument('--input', required=True, help='PDF 路徑')
    parser.add_argument('--output', default=None, help='輸出 JSON 路徑（預設 stdout）')
    args = parser.parse_args()

    words = extract_words(args.input)

    b2_count = sum(1 for v in words.values() if v == 'B2')
    c1_count = sum(1 for v in words.values() if v == 'C1')
    print(f'Extracted: {len(words)} words  (B2={b2_count}, C1={c1_count})', file=sys.stderr)

    out = json.dumps(words, ensure_ascii=False, indent=2)
    if args.output:
        with open(args.output, 'w', encoding='utf-8') as f:
            f.write(out)
        print(f'Written to {args.output}', file=sys.stderr)
    else:
        print(out)


if __name__ == '__main__':
    main()
