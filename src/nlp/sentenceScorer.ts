import { GlobalFreqEntry } from './types';

export interface ScoredSentence {
  sentence: string;
  score: number;
  chunkIndex: number;
  chapter?: string;
  id: string;
}

// 說話歸因動詞（出現在非對話句時仍降低獨立性）
const SPEECH_VERBS = /\b(said|says|asked|asks|replied|answered|shouted|whispered|muttered|exclaimed|cried|called|yelled|announced|declared|insisted|snapped|growled|murmured|breathed)\b/i;

// 代詞開頭 → 句子依賴前文才能知道指涉對象，離開原書無法獨立理解
const ANAPHORIC_PRONOUN = /^(He|She|They|His|Her|Their)\b/;

// 對話偵測：以引號 / em dash 開頭，或超過 55% 字元在引號內
function isMainlyDialogue(s: string): boolean {
  if (/^["“‘]/.test(s)) return true;
  if (/^[—–]\s/.test(s)) return true;
  let inQuote = false;
  let quotedChars = 0;
  for (const ch of s) {
    if (ch === '"' || ch === '“' || ch === '‘') { inQuote = true; continue; }
    if (ch === '"' || ch === '”' || ch === '’') { inQuote = false; continue; }
    if (inQuote) quotedChars++;
  }
  return s.length > 0 && quotedChars / s.length > 0.55;
}

// Sentence Mining 評分：離開原書後仍能獨立理解，且能幫助推測目標單字
function scoreSentence(sentence: string, targetLemma: string, targetOriginal: string): number {
  let score = 0;
  const s = sentence.trim();

  // 長度：40-120 字元最適合學習語境（SM 需要足夠前後文）
  const len = s.length;
  if (len >= 40 && len <= 120) score += 5;
  else if (len >= 20 && len <= 200) score += 3;
  else score += 1;

  // 目標詞位置：不在句首/句尾，前後有語境可供推測詞義
  const lower = s.toLowerCase();
  const wordPos = lower.indexOf(targetLemma) !== -1
    ? lower.indexOf(targetLemma)
    : lower.indexOf(targetOriginal.toLowerCase());
  if (wordPos > 0) {
    const relPos = wordPos / s.length;
    if (relPos > 0.1 && relPos < 0.85) score += 2;
  }

  // 完整句（大寫開頭、標點結尾）
  if (/^[A-Z]/.test(s) && /[.!?]$/.test(s)) score += 2;

  // 對話懲罰：依賴說話者與對話脈絡，離開原書難以獨立理解
  if (isMainlyDialogue(s)) {
    score -= 5;
  } else {
    const hasQuote = /["“”‘’]/.test(s);
    if (!hasQuote) score += 2;       // 純敘述：無引號，最適合獨立學習
    if (SPEECH_VERBS.test(s)) score -= 1; // 含說話動詞的混合句，語境稍弱
  }

  // 代詞開頭懲罰：He/She/They 需要前文才知道指涉對象
  if (ANAPHORIC_PRONOUN.test(s)) score -= 2;

  return score;
}

export function selectBestSentence(entry: GlobalFreqEntry): ScoredSentence {
  if (entry.occurrences.length === 0) {
    return { sentence: '', score: 0, chunkIndex: 0, id: '' };
  }

  let best: ScoredSentence = {
    sentence: entry.occurrences[0].sentence,
    score: -Infinity,
    chunkIndex: entry.occurrences[0].chunkIndex,
    chapter: entry.occurrences[0].chapter,
    id: entry.occurrences[0].id,
  };

  for (const occ of entry.occurrences) {
    const score = scoreSentence(occ.sentence, entry.lemma, entry.original);
    if (score > best.score) {
      best = {
        sentence: occ.sentence,
        score,
        chunkIndex: occ.chunkIndex,
        chapter: occ.chapter,
        id: occ.id,
      };
    }
  }

  return best;
}
