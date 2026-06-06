import { GeneratedCards, VocabCard, ClozeCard, CharacterCard, PlotCard } from './types';
import { CardTypes } from './generator';
import { EnrichedChunk } from '../nlp/types';
import { STOP_WORDS } from '../nlp/stopWords';

// 版權聲明、出版資訊、章節標題、網址等非故事內容的特徵
const NON_STORY_PATTERNS: RegExp[] = [
  /copyright/i,
  /all rights reserved/i,
  /\bisbn[-‐\s]?\d/i,
  /published by/i,
  /first published/i,
  /printed in/i,
  /no part of this/i,
  /reproduction.*prohibited/i,
  /©/,
  /https?:\/\//,
  /www\.[a-z]/i,
  // 章節／段落標題（CHAPTER 1、PART TWO、PROLOGUE 等）
  /^(CHAPTER|PART|PROLOGUE|EPILOGUE|APPENDIX|INTERLUDE)\b/i,
  // 句首大量數字（頁碼、年份區塊）
  /^\d[\d\s,.\-–—]{4,}/,
];

function isStorySentence(s: string): boolean {
  return !NON_STORY_PATTERNS.some(re => re.test(s));
}

export function extractSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 30 && s.length < 200 && isStorySentence(s));
}

export function findSentenceWith(word: string, sentences: string[]): string | undefined {
  const lower = word.toLowerCase();
  return sentences.find(s => s.toLowerCase().includes(lower));
}

function findSentenceWithRaw(word: string, text: string): string | undefined {
  const lower = word.toLowerCase();
  return text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .find(s => s.toLowerCase().includes(lower));
}

function extractLongWords(text: string): string[] {
  const words = text.toLowerCase().match(/\b[a-z]{7,}\b/g) ?? [];
  const unique = [...new Set(words)].filter(w => !STOP_WORDS.has(w));
  return unique.slice(0, 10);
}

// 常見功能詞：即使出現在句子中間也不是專有名詞
const FUNCTION_WORDS = new Set([
  'The','This','That','These','Those',
  'He','She','It','They','We','You','I',
  'His','Her','Its','Their','Our','Your','My',
  'But','And','Or','Yet','So','For','Nor',
  'With','From','Into','Upon','Unto','Over','Under','After','Before',
  'Then','Now','Still','Just','Even','Only','Also','Soon','Here','There',
  'Had','Was','Were','Has','Have','Did','Does','Not',
  'What','When','Where','Who','Which','How','Why',
  'All','Any','Some','Such','Each','Every','Both',
]);

export function extractCapitalizedNames(text: string): string[] {
  // lookbehind: 只取前面是小寫字母或逗號/分號的大寫字，濾掉句首大寫
  const names = text.match(/(?<=[a-z,;]\s)\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?\b/g) ?? [];
  return [...new Set(names)].filter(n => !FUNCTION_WORDS.has(n)).slice(0, 5);
}

function mockVocab(chunk: EnrichedChunk): VocabCard[] {
  const suggestions = chunk.nlp.vocabSuggestions;
  const sentences = extractSentences(chunk.text);

  const storyText = sentences.join(' ');
  const words = suggestions.length > 0
    ? suggestions.slice(0, 4).map(s => s.original)
    : extractLongWords(storyText).slice(0, 4);

  return words
    .map(word => {
      const exampleFromText =
        findSentenceWith(word, sentences) ?? findSentenceWithRaw(word, chunk.text);
      if (!exampleFromText) return null;
      return { type: 'vocab' as const, word, definition_zh: '', exampleFromText };
    })
    .filter((c): c is VocabCard => c !== null);
}

function mockCloze(chunk: EnrichedChunk): ClozeCard[] {
  const sentences = extractSentences(chunk.text).slice(0, 2);
  return sentences.flatMap(sentence => {
    const words = sentence.split(' ').filter(w => w.length >= 5);
    const target = words[Math.floor(words.length / 2)] ?? words[0] ?? '';
    const clean = target.replace(/[^a-zA-Z]/g, '');
    if (!clean) return [];
    // 用 target（原始形式，含 apostrophe）搜尋，clean（純字母）作為填空詞
    const cloze = sentence.replace(target, `{{c1::${clean}}}`);
    if (cloze === sentence) return []; // replace 未命中，略過此句
    return [{ type: 'cloze' as const, text: cloze, hint_zh: '' }];
  });
}

function mockCharacter(chunk: EnrichedChunk): CharacterCard[] {
  const sentences = extractSentences(chunk.text);
  const storyText = sentences.join(' ');
  const names = extractCapitalizedNames(storyText).slice(0, 2);
  return names
    .map(name => {
      const firstMention = sentences.find(s => s.includes(name));
      if (!firstMention) return null;
      return { type: 'character' as const, name, description_zh: '', firstMention };
    })
    .filter((c): c is CharacterCard => c !== null);
}

function buildPlotQuestion(chunk: EnrichedChunk, sentences: string[]): string {
  const storyText = sentences.join(' ');
  const names = extractCapitalizedNames(storyText).slice(0, 2);
  const chapterTag = chunk.chapter ? `【${chunk.chapter}】` : '';
  const namePart = names.length > 0 ? `涉及 ${names.join('、')}，` : '';
  const opening = sentences[0] ? `段落開頭：「${sentences[0].slice(0, 60)}…」` : '';
  return `${chapterTag}${namePart}${opening}\n這段場景發生了什麼事？請用繁體中文摘要。`;
}

function mockPlot(chunk: EnrichedChunk): PlotCard[] {
  const sentences = extractSentences(chunk.text);
  const sourceText = sentences.slice(0, 5).join(' ');
  if (!sourceText) return [];
  return [{
    type: 'plot' as const,
    question_zh: buildPlotQuestion(chunk, sentences),
    answer_zh: sourceText,
  }];
}

export function generateMockCards(chunk: EnrichedChunk, types: CardTypes[]): GeneratedCards {
  return {
    vocab: types.includes('vocab') ? mockVocab(chunk) : [],
    cloze: types.includes('cloze') ? mockCloze(chunk) : [],
    character: types.includes('character') ? mockCharacter(chunk) : [],
    plot: types.includes('plot') ? mockPlot(chunk) : [],
  };
}
