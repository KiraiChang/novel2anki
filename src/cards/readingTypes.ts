// 讀書導向字卡型別
// 複用既有卡片結構，透過 cardClass 欄位區分「語言學習」與「讀書理解」兩種視角

export interface ReadingTermCard {
  type: 'vocab';
  cardClass: 'reading-term';   // 書中高頻專有名詞 / 世界觀術語
  word: string;
  definition_zh: string;        // 此詞在本書的含義（AI 填入）
  exampleFromText: string;      // 出現頻率最高的代表句
  frequency: number;            // 全書出現次數（供排序與 ai_hint 參考）
}

export interface ReadingCauseCard {
  type: 'plot';
  cardClass: 'reading-cause';   // 因果轉折事件
  question_zh: string;          // 「為什麼…？」或「…導致了什麼？」
  answer_zh: string;            // 因果句原文（AI 填入繁中解釋）
}

export interface ReadingChapterCard {
  type: 'plot';
  cardClass: 'reading-chapter'; // 章節脈絡理解
  question_zh: string;          // 「這章的核心事件是什麼？」
  answer_zh: string;            // 首句 + 尾句原文（AI 填入章節摘要）
}

export interface ReadingThemeCard {
  type: 'character';
  cardClass: 'reading-theme';   // 全書反覆出現的意象詞
  name: string;                 // 意象詞（如 darkness / blood / power）
  description_zh: string;       // 此意象在本書的象徵意義（AI 填入）
  firstMention: string;         // 頻率最高的代表句
  frequency: number;            // 全書出現次數
}

export type AnyReadingCard =
  | ReadingTermCard
  | ReadingCauseCard
  | ReadingChapterCard
  | ReadingThemeCard;

export interface ReadingCards {
  terms: ReadingTermCard[];
  causes: ReadingCauseCard[];
  chapters: ReadingChapterCard[];
  themes: ReadingThemeCard[];
}

export const EMPTY_READING_CARDS: ReadingCards = {
  terms: [],
  causes: [],
  chapters: [],
  themes: [],
};
