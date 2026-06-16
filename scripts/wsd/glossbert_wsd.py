#!/usr/bin/env python3
"""
WSD（Word Sense Disambiguation）腳本：從 MW shortdefs 中選出最符合語境的詞義。

使用 sentence-transformers 計算 context_sentence 與每個 shortdef 的 cosine similarity，
選出分數最高的 shortdef index。

升級路徑：
  PoC 模型  — sentence-transformers all-MiniLM-L6-v2（22MB，CPU 可跑）
  生產模型  — IDEA-CCNL/Erlangshen-GlossBERT-WSD（真正的 GlossBERT，效果更好）

環境設定（venv，請在 scripts/wsd/ 目錄下執行）：
  python -m venv .venv

  # Windows
  .venv\\Scripts\\pip install -r requirements.txt

  # Mac / Linux
  .venv/bin/pip install -r requirements.txt

手動測試：
  # Windows
  echo '[{"word":"bank","shortdefs":["a financial institution","slope beside a river"],"sentence":"He crossed the muddy bank."}]' | .venv\\Scripts\\python glossbert_wsd.py

  # Mac / Linux
  echo '[...]' | .venv/bin/python glossbert_wsd.py

stdin:  JSON 陣列，每項 { word, shortdefs: string[], sentence }
stdout: JSON 陣列，每項 { word, chosen_index, score }
stderr: 進度資訊
"""

import sys
import json
import numpy as np

MODEL_NAME = "all-MiniLM-L6-v2"


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(np.dot(a, b) / (norm_a * norm_b))


def main() -> None:
    raw = sys.stdin.read().strip()
    if not raw:
        print("[]")
        return

    try:
        requests = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"[WSD] JSON parse error: {e}", file=sys.stderr)
        print("[]")
        return

    if not requests:
        print("[]")
        return

    # 載入模型（只載入一次）
    print(f"[WSD] Loading model '{MODEL_NAME}'...", file=sys.stderr)
    try:
        from sentence_transformers import SentenceTransformer
        model = SentenceTransformer(MODEL_NAME)
    except ImportError:
        print("[WSD] ERROR: sentence-transformers not installed. Run: pip install -r scripts/wsd/requirements.txt", file=sys.stderr)
        # Fallback：全部回傳 index 0
        results = [{"word": r["word"], "chosen_index": 0, "score": 0.0} for r in requests]
        print(json.dumps(results, ensure_ascii=False))
        return

    print(f"[WSD] Model loaded. Processing {len(requests)} items...", file=sys.stderr)

    # 收集所有待 encode 的文字（sentence + 所有 shortdefs）
    # 批次 encode 提升效率
    all_texts: list[str] = []
    for req in requests:
        sentence = req.get("sentence", "")
        shortdefs = req.get("shortdefs", [])
        all_texts.append(sentence)
        all_texts.extend(shortdefs)

    embeddings = model.encode(all_texts, show_progress_bar=False, batch_size=64)

    results = []
    ptr = 0
    for req in requests:
        word = req.get("word", "")
        shortdefs = req.get("shortdefs", [])

        sentence_emb = embeddings[ptr]
        ptr += 1

        if not shortdefs:
            results.append({"word": word, "chosen_index": 0, "score": 0.0})
            continue

        best_idx = 0
        best_score = -1.0
        for i, _ in enumerate(shortdefs):
            gloss_emb = embeddings[ptr + i]
            score = cosine_similarity(sentence_emb, gloss_emb)
            if score > best_score:
                best_score = score
                best_idx = i

        ptr += len(shortdefs)
        results.append({"word": word, "chosen_index": best_idx, "score": round(best_score, 4)})

    print(f"[WSD] Done. Changed {sum(1 for r in results if r['chosen_index'] != 0)} / {len(results)} selections.", file=sys.stderr)
    print(json.dumps(results, ensure_ascii=False))


if __name__ == "__main__":
    main()
