#!/usr/bin/env python3
"""
處理 Oxford 5000 原始 JSON → word:level 格式
需先下載原始資料：
  curl -s https://raw.githubusercontent.com/tyypgzl/Oxford-5000-words/main/full-word.json \
       -o /tmp/oxford5000-full.json

用法：
  python3 scripts/process-oxford.py [--input /tmp/oxford5000-full.json] [--output src/data/oxford-base.json]
"""

import json
import sys
import argparse
from collections import defaultdict

LEVEL_ORDER = {'A1': 0, 'A2': 1, 'B1': 2, 'B2': 3, 'C1': 4, 'C2': 5}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', default='/tmp/oxford5000-full.json')
    parser.add_argument('--output', default=None)
    args = parser.parse_args()

    with open(args.input, encoding='utf-8') as f:
        data = json.load(f)

    word_levels = defaultdict(list)
    for item in data:
        v = item.get('value', item)
        word = v.get('word', '').lower().strip()
        level = v.get('level', '').strip()
        if word and level and level in LEVEL_ORDER:
            word_levels[word].append(level)

    # 同字多詞性取最低等級（學習者先掌握基礎用法）
    result = {}
    for word, levels in word_levels.items():
        result[word] = min(levels, key=lambda l: LEVEL_ORDER[l])

    result = dict(sorted(result.items()))

    from collections import Counter
    dist = dict(sorted(Counter(result.values()).items()))
    print(f"Processed: {len(result)} unique words", file=sys.stderr)
    print(f"Distribution: {dist}", file=sys.stderr)

    if args.output:
        with open(args.output, 'w', encoding='utf-8') as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
        print(f"Written to {args.output}", file=sys.stderr)
    else:
        print(json.dumps(result, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()
