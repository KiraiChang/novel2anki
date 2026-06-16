#!/usr/bin/env python3
"""
POS Tagger：使用 spaCy 對例句標記詞性，回傳目標詞在該句中的 Universal POS tag。

輸入（stdin）：JSON 陣列
  [{"word": "against", "sentence": "She put her head against a wall."}, ...]

輸出（stdout）：JSON 陣列（與輸入等長、同順序）
  [{"word": "against", "pos": "Preposition"}, ...]
  pos 為空字串代表在句中找不到目標詞，由 TypeScript 層 fallback 處理。

環境設定（請在 scripts/pos/ 目錄下執行）：
  python setup.py

手動測試：
  # Windows
  echo '[{"word":"against","sentence":"She put her head against a wall."}]' | .venv\\Scripts\\python pos_tagger.py

  # Mac / Linux
  echo '[{"word":"against","sentence":"She put her head against a wall."}]' | .venv/bin/python pos_tagger.py
"""

import sys
import json

import spacy

# Universal Dependencies POS → compromise 相容格式
_UD_TO_POS: dict[str, str] = {
    'NOUN':  'Noun',
    'PROPN': 'Noun',
    'VERB':  'Verb',
    'AUX':   'Verb',
    'ADJ':   'Adjective',
    'ADV':   'Adverb',
    'ADP':   'Preposition',
    'CCONJ': 'Conjunction',
    'SCONJ': 'Conjunction',
    'CONJ':  'Conjunction',
    'NUM':   'Noun',
    'PRON':  'Noun',
}


def detect_pos(nlp, word: str, sentence: str) -> str:
    doc = nlp(sentence)
    w = word.lower()
    for token in doc:
        if token.lemma_.lower() == w or token.text.lower() == w:
            return _UD_TO_POS.get(token.pos_, '')
    return ''


def main() -> None:
    nlp = spacy.load('en_core_web_sm', disable=['ner', 'parser'])

    requests = json.loads(sys.stdin.read())
    results = [
        {'word': req['word'], 'pos': detect_pos(nlp, req['word'], req['sentence'])}
        for req in requests
    ]
    print(json.dumps(results))


if __name__ == '__main__':
    main()
