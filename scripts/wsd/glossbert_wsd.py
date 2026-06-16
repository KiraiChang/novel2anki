#!/usr/bin/env python3
"""
WSD（Word Sense Disambiguation）腳本：從 MW shortdefs 中選出最符合語境的詞義。

使用 transformers 直接載入 BAAI/bge-base-en-v1.5，計算 context_sentence 與
每個 shortdef 的 cosine similarity，選出分數最高的 shortdef index。

模型選擇：
  CPU（預設）— BAAI/bge-base-en-v1.5（110 MB）
  GPU        — 將 MODEL_NAME 改為 BAAI/bge-large-en-v1.5（335 MB，精度更高）

  bge 系列針對非對稱語意相似度訓練（query vs passage），適合本專案的
  (context_sentence, MW shortdef) 配對場景。encode 時 sentence 使用
  "Represent this sentence for searching relevant passages: " 前綴，
  shortdef 不加前綴，符合 bge 官方建議的 asymmetric retrieval 用法。

  升級路徑（日後如需 WSD 專屬訓練）：
    liyucheng259/GlossBERT — 以 SemCor + WordNet 訓練的 BERT 二元分類模型，
    需改寫推論邏輯（(sentence+gloss) → classification score，非 cosine-sim）。

環境設定（venv，請在 scripts/wsd/ 目錄下執行）：
  python setup.py

手動測試：
  # Windows
  echo '[{"word":"bank","shortdefs":["a financial institution","slope beside a river"],"sentence":"He crossed the muddy bank."}]' | .venv\\Scripts\\python glossbert_wsd.py

  # Mac / Linux
  echo '[...]' | .venv/bin/python glossbert_wsd.py

stdin:  JSON 陣列，每項 { word, shortdefs: string[], sentence }
stdout: JSON 陣列，每項 { word, chosen_index, score }
stderr: 進度資訊
"""

from __future__ import annotations

import os
import sys
import json
import numpy as np

# Windows 不支援 symlink，suppresses HuggingFace 快取警告（不影響功能）
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

# CPU 建議：bge-base-en-v1.5（110 MB）
# GPU 建議：bge-large-en-v1.5（335 MB，精度更高）
MODEL_NAME = "BAAI/bge-base-en-v1.5"

# bge 非對稱 retrieval 前綴：sentence 加，shortdef 不加
BGE_QUERY_PREFIX = "Represent this sentence for searching relevant passages: "


def encode_texts(tokenizer, model, texts: list[str], batch_size: int = 32) -> np.ndarray:
    """使用 transformers 直接編碼文字，回傳 L2 正規化的 embedding 矩陣。"""
    import torch
    import torch.nn.functional as F

    if not texts:
        hidden = model.config.hidden_size
        return np.zeros((0, hidden), dtype=np.float32)

    all_embeddings: list[np.ndarray] = []
    for i in range(0, len(texts), batch_size):
        batch = [str(t) for t in texts[i : i + batch_size]]
        inputs = tokenizer(
            batch,
            padding=True,
            truncation=True,
            max_length=512,
            return_tensors="pt",
        )
        with torch.no_grad():
            outputs = model(**inputs)
        # BGE 使用 CLS token 作為句子表示
        emb = outputs.last_hidden_state[:, 0, :]
        emb = F.normalize(emb, p=2, dim=1)
        all_embeddings.append(emb.cpu().numpy())

    return np.vstack(all_embeddings)


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

    print(f"[WSD] Loading model '{MODEL_NAME}'...", file=sys.stderr)
    try:
        from transformers import AutoTokenizer, AutoModel

        # use_fast=False：繞開 tokenizers 0.20+ Rust encode_batch 型別驗證問題
        tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME, use_fast=False)
        model = AutoModel.from_pretrained(MODEL_NAME)
        model.eval()
    except ImportError:
        print(
            "[WSD] ERROR: transformers / torch not installed. Run: python scripts/wsd/setup.py",
            file=sys.stderr,
        )
        results = [{"word": r.get("word", ""), "chosen_index": 0, "score": 0.0} for r in requests]
        print(json.dumps(results, ensure_ascii=False))
        return

    print(f"[WSD] Model loaded. Processing {len(requests)} items...", file=sys.stderr)

    # 準備 sentences（加 BGE query prefix）與所有 shortdefs
    raw_sentences = [str(req.get("sentence") or "").strip() for req in requests]
    sentences = [BGE_QUERY_PREFIX + s for s in raw_sentences]

    all_shortdefs: list[str] = []
    shortdef_counts: list[int] = []
    for req in requests:
        defs = req.get("shortdefs") or []
        clean = [str(d) for d in defs if d is not None and str(d).strip()]
        all_shortdefs.extend(clean)
        shortdef_counts.append(len(clean))

    sentence_embeddings = encode_texts(tokenizer, model, sentences)
    gloss_embeddings = encode_texts(tokenizer, model, all_shortdefs) if all_shortdefs else np.zeros((0, model.config.hidden_size))

    results = []
    gloss_ptr = 0
    for i, req in enumerate(requests):
        word = req.get("word", "")
        n = shortdef_counts[i]

        if n == 0:
            results.append({"word": word, "chosen_index": 0, "score": 0.0})
            continue

        sent_emb = sentence_embeddings[i]
        best_idx = 0
        best_score = -1.0
        for j in range(n):
            g = gloss_embeddings[gloss_ptr + j]
            # normalize_embeddings=True 後 dot product 等同 cosine similarity
            score = float(np.dot(sent_emb, g))
            if score > best_score:
                best_score = score
                best_idx = j

        gloss_ptr += n
        results.append({"word": word, "chosen_index": best_idx, "score": round(best_score, 4)})

    changed = sum(1 for r in results if r["chosen_index"] != 0)
    print(f"[WSD] Done. Changed {changed} / {len(results)} selections.", file=sys.stderr)
    print(json.dumps(results, ensure_ascii=False))


if __name__ == "__main__":
    main()
