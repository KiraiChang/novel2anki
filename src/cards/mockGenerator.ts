import { Chunk, GeneratedCards, VocabCard, ClozeCard, CharacterCard, PlotCard } from './types';
import { CardTypes } from './generator';

const COMMON_WORDS = new Set([
  'the','a','an','and','or','but','in','on','at','to','for','of','with','by',
  'from','is','are','was','were','be','been','being','have','has','had','do',
  'does','did','will','would','could','should','may','might','shall','can',
  'not','no','so','if','as','it','its','this','that','these','those','he',
  'she','they','we','you','i','my','his','her','their','our','your','his',
  'what','which','who','when','where','how','all','more','also','just','then',
  'than','there','about','into','up','out','over','after','before','between',
  'said','says','say','one','two','three','like','get','got','go','went',
]);

function extractSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 30 && s.length < 200);
}

function extractLongWords(text: string): string[] {
  const words = text.toLowerCase().match(/\b[a-z]{7,}\b/g) ?? [];
  const unique = [...new Set(words)].filter(w => !COMMON_WORDS.has(w));
  return unique.slice(0, 10);
}

function extractCapitalizedNames(text: string): string[] {
  const names = text.match(/\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?\b/g) ?? [];
  const filtered = names.filter(n => !['The','This','That','It','He','She','They'].includes(n));
  return [...new Set(filtered)].slice(0, 5);
}

function mockVocab(chunk: Chunk): VocabCard[] {
  const words = extractLongWords(chunk.text).slice(0, 4);
  const sentences = extractSentences(chunk.text);
  return words.map((word, i) => ({
    type: 'vocab' as const,
    word,
    definition_zh: `【模擬】「${word}」的繁體中文定義（請以 API 模式重新產生）`,
    exampleFromText: sentences[i % sentences.length] ?? chunk.text.slice(0, 100),
  }));
}

function mockCloze(chunk: Chunk): ClozeCard[] {
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

function mockCharacter(chunk: Chunk): CharacterCard[] {
  const names = extractCapitalizedNames(chunk.text).slice(0, 2);
  const sentences = extractSentences(chunk.text);
  return names.map((name, i) => ({
    type: 'character' as const,
    name,
    description_zh: `【模擬】「${name}」是本段落中出現的人物或地點（請以 API 模式重新產生完整描述）`,
    firstMention: sentences.find(s => s.includes(name)) ?? chunk.text.slice(0, 100),
  }));
}

function mockPlot(chunk: Chunk): PlotCard[] {
  const sentences = extractSentences(chunk.text);
  const summary = sentences.slice(0, 3).join(' ');
  return [{
    type: 'plot' as const,
    question_zh: `【模擬】這個段落${chunk.chapter ? `（${chunk.chapter}）` : ''}主要描述了什麼？`,
    answer_zh: `【模擬】重點摘要：${summary.slice(0, 150)}...（請以 API 模式重新產生完整摘要）`,
  }];
}

export function generateMockCards(chunk: Chunk, types: CardTypes[]): GeneratedCards {
  return {
    vocab: types.includes('vocab') ? mockVocab(chunk) : [],
    cloze: types.includes('cloze') ? mockCloze(chunk) : [],
    character: types.includes('character') ? mockCharacter(chunk) : [],
    plot: types.includes('plot') ? mockPlot(chunk) : [],
  };
}
