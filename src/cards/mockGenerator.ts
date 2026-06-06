import { GeneratedCards, VocabCard, ClozeCard, CharacterCard, PlotCard } from './types';
import { CardTypes } from './generator';
import { EnrichedChunk } from '../nlp/types';
import { STOP_WORDS } from '../nlp/stopWords';

// 版權聲明、出版資訊、網址等非故事內容的特徵
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

function extractLongWords(text: string): string[] {
  const words = text.toLowerCase().match(/\b[a-z]{7,}\b/g) ?? [];
  const unique = [...new Set(words)].filter(w => !STOP_WORDS.has(w));
  return unique.slice(0, 10);
}

export function extractCapitalizedNames(text: string): string[] {
  const names = text.match(/\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?\b/g) ?? [];
  const filtered = names.filter(n => !['The','This','That','It','He','She','They'].includes(n));
  return [...new Set(filtered)].slice(0, 5);
}

function mockVocab(chunk: EnrichedChunk): VocabCard[] {
  const suggestions = chunk.nlp.vocabSuggestions;
  const sentences = extractSentences(chunk.text);

  const storyText = sentences.join(' ');
  const words = suggestions.length > 0
    ? suggestions.slice(0, 4).map(s => s.original)
    : extractLongWords(storyText).slice(0, 4);

  return words.map(word => ({
    type: 'vocab' as const,
    word,
    definition_zh: `【模擬】「${word}」的繁體中文定義（請以 API 模式重新產生）`,
    exampleFromText: findSentenceWith(word, sentences) ?? chunk.text.slice(0, 200),
  }));
}

function mockCloze(chunk: EnrichedChunk): ClozeCard[] {
  const sentences = extractSentences(chunk.text).slice(0, 2);
  return sentences.map(sentence => {
    const words = sentence.split(' ').filter(w => w.length >= 5);
    const target = words[Math.floor(words.length / 2)] ?? words[0] ?? 'word';
    const clean = target.replace(/[^a-zA-Z]/g, '');
    const cloze = sentence.replace(clean, `{{c1::${clean}}}`);
    return {
      type: 'cloze' as const,
      text: cloze,
      hint_zh: `【模擬】填入適當的英文單字`,
    };
  });
}

function mockCharacter(chunk: EnrichedChunk): CharacterCard[] {
  const names = extractCapitalizedNames(chunk.text).slice(0, 2);
  const sentences = extractSentences(chunk.text);
  return names.map((name, i) => ({
    type: 'character' as const,
    name,
    description_zh: `【模擬】「${name}」是本段落中出現的人物或地點（請以 API 模式重新產生完整描述）`,
    firstMention: sentences.find(s => s.includes(name)) ?? chunk.text.slice(0, 100),
  }));
}

function mockPlot(chunk: EnrichedChunk): PlotCard[] {
  const sentences = extractSentences(chunk.text);
  const summary = sentences.slice(0, 3).join(' ');
  return [{
    type: 'plot' as const,
    question_zh: `【模擬】這個段落${chunk.chapter ? `（${chunk.chapter}）` : ''}主要描述了什麼？`,
    answer_zh: `【模擬】重點摘要：${summary.slice(0, 150)}...（請以 API 模式重新產生完整摘要）`,
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
