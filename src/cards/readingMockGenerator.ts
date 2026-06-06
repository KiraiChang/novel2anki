import { EnrichedChunk } from '../nlp/types';
import { STOP_WORDS } from '../nlp/stopWords';
import { extractSentences } from './mockGenerator';
import {
  ReadingCards, ReadingTermCard, ReadingCauseCard,
  ReadingChapterCard, ReadingThemeCard, EMPTY_READING_CARDS,
} from './readingTypes';

// ── 常數 ──────────────────────────────────────────────────────────────────────

// 因果標記詞
const CAUSAL_MARKERS = [
  'because', 'since', 'therefore', 'thus', 'hence', 'so that',
  'as a result', 'led to', 'caused', 'due to', 'consequently',
];

// 不當作主題意象的通用詞（補充 STOP_WORDS 中未涵蓋的短功能詞）
const THEME_EXCLUDE = new Set([
  'could', 'would', 'should', 'might', 'must', 'shall',
  'upon', 'into', 'onto', 'within', 'without', 'against',
  'through', 'toward', 'around', 'along', 'across', 'behind',
  'perhaps', 'though', 'still', 'always', 'never', 'every',
  'another', 'other', 'much', 'many', 'only', 'even', 'such',
  'first', 'last', 'long', 'little', 'great', 'small', 'same',
  'both', 'each', 'some', 'most', 'back', 'away', 'down',
  'himself', 'herself', 'itself', 'themselves', 'again', 'once',
]);

// 術語去重時排除的常見英文詞（非書中專有名詞）
const TERM_EXCLUDE = new Set([
  'Chapter', 'Part', 'Book', 'Section', 'Page', 'Volume',
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
  'January', 'February', 'March', 'April', 'June', 'July', 'August',
  'September', 'October', 'November', 'December',
]);

// ── 第一階段：全局統計 ─────────────────────────────────────────────────────────

interface GlobalStats {
  // 大寫專有名詞頻率（書中術語候選）
  termFreq: Map<string, { count: number; sentences: string[] }>;
  // 一般內容詞頻率（主題意象候選）
  themeFreq: Map<string, { count: number; sentences: string[] }>;
  // 因果句
  causeSentences: Array<{ sentence: string; marker: string; chunk: EnrichedChunk }>;
  // 每章首尾句
  chapterBoundaries: Array<{ chapter: string; opening: string; closing: string }>;
}

function splitSentences(text: string): string[] {
  // 使用 extractSentences 過濾版權行、標題等非故事內容
  // 另外允許長句（因果句可超過 200 字），故補充一個寬鬆版
  const filtered = extractSentences(text); // 30–200 字，已過濾非故事句
  const loose = text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 200 && s.length <= 500); // 長因果句補充
  return [...filtered, ...loose];
}

function collectGlobalStats(chunks: EnrichedChunk[]): GlobalStats {
  const termFreq = new Map<string, { count: number; sentences: string[] }>();
  const themeFreq = new Map<string, { count: number; sentences: string[] }>();
  const causeSentences: GlobalStats['causeSentences'] = [];
  const chapterMap = new Map<string, { opening: string; closing: string }>();

  for (const chunk of chunks) {
    const sentences = splitSentences(chunk.text);
    if (sentences.length === 0) continue;

    // 章節首尾句
    const chapter = chunk.chapter ?? 'unnamed';
    if (!chapterMap.has(chapter)) {
      chapterMap.set(chapter, { opening: sentences[0], closing: sentences[sentences.length - 1] });
    } else {
      // 更新該章節的最後一句
      chapterMap.get(chapter)!.closing = sentences[sentences.length - 1];
    }

    for (const sentence of sentences) {
      // 大寫術語頻率（非句首、4+ 字元）
      const terms = sentence.match(/(?<=[a-z,;.!?]\s)\b[A-Z][a-zA-Z]{3,}(?:\s+[A-Z][a-zA-Z]{2,})?\b/g) ?? [];
      for (const term of terms) {
        if (TERM_EXCLUDE.has(term)) continue;
        const entry = termFreq.get(term) ?? { count: 0, sentences: [] };
        entry.count++;
        if (entry.sentences.length < 3) entry.sentences.push(sentence);
        termFreq.set(term, entry);
      }

      // 主題詞頻率（5+ 字元、非停用詞、非全大寫）
      const words = sentence.match(/\b[a-z]{5,}\b/g) ?? [];
      for (const word of words) {
        if (STOP_WORDS.has(word) || THEME_EXCLUDE.has(word)) continue;
        const entry = themeFreq.get(word) ?? { count: 0, sentences: [] };
        entry.count++;
        if (entry.sentences.length < 2) entry.sentences.push(sentence);
        themeFreq.set(word, entry);
      }

      // 因果句
      const lowerSentence = sentence.toLowerCase();
      for (const marker of CAUSAL_MARKERS) {
        if (lowerSentence.includes(marker) && sentence.length <= 300) {
          causeSentences.push({ sentence, marker, chunk });
          break;
        }
      }
    }
  }

  const chapterBoundaries = [...chapterMap.entries()].map(([chapter, { opening, closing }]) => ({
    chapter, opening, closing,
  }));

  return { termFreq, themeFreq, causeSentences, chapterBoundaries };
}

// ── 第二階段：卡片生成 ─────────────────────────────────────────────────────────

function generateTermCards(stats: GlobalStats, limit: number): ReadingTermCard[] {
  return [...stats.termFreq.entries()]
    .filter(([, v]) => v.count >= 2)                 // 至少出現 2 次才算關鍵術語
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, limit)
    .map(([word, { count, sentences }]) => ({
      type: 'vocab' as const,
      cardClass: 'reading-term' as const,
      word,
      definition_zh: '',
      exampleFromText: sentences.sort((a, b) => b.length - a.length)[0] ?? '',
      frequency: count,
    }));
}

function generateCauseCards(stats: GlobalStats, limit: number): ReadingCauseCard[] {
  return stats.causeSentences
    .slice(0, limit)
    .map(({ sentence, marker }) => {
      const markerIdx = sentence.toLowerCase().indexOf(marker);
      const isCauseFirst = markerIdx > sentence.length / 2;
      const question = isCauseFirst
        ? `這個結果是怎麼發生的？（線索：「${marker}」）`
        : `「${sentence.slice(0, 40).trim()}…」導致了什麼？`;
      return {
        type: 'plot' as const,
        cardClass: 'reading-cause' as const,
        question_zh: question,
        answer_zh: sentence,
      };
    });
}

function generateChapterCards(stats: GlobalStats): ReadingChapterCard[] {
  return stats.chapterBoundaries.map(({ chapter, opening, closing }) => ({
    type: 'plot' as const,
    cardClass: 'reading-chapter' as const,
    question_zh: `【${chapter}】這章的核心事件是什麼？`,
    answer_zh: opening === closing
      ? opening
      : `${opening}\n\n${closing}`,
  }));
}

function generateThemeCards(stats: GlobalStats, limit: number): ReadingThemeCard[] {
  return [...stats.themeFreq.entries()]
    .filter(([, v]) => v.count >= 3)                 // 至少出現 3 次才算主題意象
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, limit)
    .map(([word, { count, sentences }]) => ({
      type: 'character' as const,
      cardClass: 'reading-theme' as const,
      name: word,
      description_zh: '',
      firstMention: sentences[0] ?? '',
      frequency: count,
    }));
}

// ── 公開 API ──────────────────────────────────────────────────────────────────

export interface ReadingMockOptions {
  maxTerms?: number;
  maxCauses?: number;
  maxThemes?: number;
}

export function generateReadingMockCards(
  chunks: EnrichedChunk[],
  options: ReadingMockOptions = {},
): ReadingCards {
  if (chunks.length === 0) return EMPTY_READING_CARDS;

  const { maxTerms = 15, maxCauses = 10, maxThemes = 8 } = options;

  const stats = collectGlobalStats(chunks);

  return {
    terms: generateTermCards(stats, maxTerms),
    causes: generateCauseCards(stats, maxCauses),
    chapters: generateChapterCards(stats),
    themes: generateThemeCards(stats, maxThemes),
  };
}
