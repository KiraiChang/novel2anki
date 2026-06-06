import { GeneratedCards, VocabCard, ClozeCard, CharacterCard, PlotCard } from './types';
import { CardTypes } from './generator';
import { EnrichedChunk } from '../nlp/types';
import { DeepLConfig, batchTranslate } from './deeplTranslator';
import {
  extractSentences,
  findSentenceWith,
  extractCapitalizedNames,
} from './mockGenerator';

// Free Dictionary API — no key required
const DICT_API = 'https://api.dictionaryapi.dev/api/v2/entries/en';

interface DictEntry {
  meanings: Array<{
    partOfSpeech: string;
    definitions: Array<{ definition: string }>;
  }>;
}

async function fetchEnglishDefinition(word: string): Promise<string | null> {
  try {
    const res = await fetch(`${DICT_API}/${encodeURIComponent(word)}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json() as DictEntry[];
    const meaning = data[0]?.meanings[0];
    if (!meaning) return null;
    const def = meaning.definitions[0]?.definition ?? null;
    return def ? `(${meaning.partOfSpeech}) ${def}` : null;
  } catch {
    return null;
  }
}

async function generateVocab(chunk: EnrichedChunk, config: DeepLConfig): Promise<VocabCard[]> {
  const sentences = extractSentences(chunk.text);
  const storyText = sentences.join(' ');
  const suggestions = chunk.nlp.vocabSuggestions;

  const words = suggestions.length > 0
    ? suggestions.slice(0, 4).map(s => s.original)
    : (storyText.toLowerCase().match(/\b[a-z]{7,}\b/g) ?? []).slice(0, 4);

  // fetch English definitions in parallel, fall back to a template on failure
  const englishDefs = await Promise.all(
    words.map(w => fetchEnglishDefinition(w).then(d => d ?? `Definition of "${w}"`)),
  );

  const zhDefs = await batchTranslate(englishDefs, config);

  return words.map((word, i) => ({
    type: 'vocab' as const,
    word,
    definition_zh: zhDefs[i] ?? englishDefs[i],
    exampleFromText: findSentenceWith(word, sentences) ?? chunk.text.slice(0, 200),
  }));
}

async function generateCloze(chunk: EnrichedChunk, config: DeepLConfig): Promise<ClozeCard[]> {
  const sentences = extractSentences(chunk.text).slice(0, 2);
  if (sentences.length === 0) return [];

  const englishHints = sentences.map(s => {
    const words = s.split(' ').filter(w => w.length >= 5);
    const target = words[Math.floor(words.length / 2)] ?? words[0] ?? 'word';
    return `Fill in the blank: the missing word is related to "${target.replace(/[^a-zA-Z]/g, '')}"`;
  });

  const zhHints = await batchTranslate(englishHints, config);

  return sentences.map((sentence, i) => {
    const words = sentence.split(' ').filter(w => w.length >= 5);
    const target = words[Math.floor(words.length / 2)] ?? words[0] ?? 'word';
    const clean = target.replace(/[^a-zA-Z]/g, '');
    return {
      type: 'cloze' as const,
      text: sentence.replace(clean, `{{c1::${clean}}}`),
      hint_zh: zhHints[i] ?? englishHints[i],
    };
  });
}

async function generateCharacter(chunk: EnrichedChunk, config: DeepLConfig): Promise<CharacterCard[]> {
  const names = extractCapitalizedNames(chunk.text).slice(0, 2);
  if (names.length === 0) return [];

  const sentences = extractSentences(chunk.text);
  const englishDescs = names.map(name => {
    const mention = sentences.find(s => s.includes(name)) ?? chunk.text.slice(0, 100);
    return `${name} is a character or place mentioned in this passage. First mentioned: "${mention}"`;
  });

  const zhDescs = await batchTranslate(englishDescs, config);

  return names.map((name, i) => ({
    type: 'character' as const,
    name,
    description_zh: zhDescs[i] ?? englishDescs[i],
    firstMention: sentences.find(s => s.includes(name)) ?? chunk.text.slice(0, 100),
  }));
}

async function generatePlot(chunk: EnrichedChunk, config: DeepLConfig): Promise<PlotCard[]> {
  const sentences = extractSentences(chunk.text);
  const summary = sentences.slice(0, 3).join(' ');
  const chapterLabel = chunk.chapter ? ` (${chunk.chapter})` : '';

  const [zhQuestion, zhAnswer] = await batchTranslate([
    `What is the main event or theme in this passage${chapterLabel}?`,
    `Summary: ${summary.slice(0, 300)}`,
  ], config);

  return [{
    type: 'plot' as const,
    question_zh: zhQuestion,
    answer_zh: zhAnswer,
  }];
}

export async function generateDeepLCards(
  chunk: EnrichedChunk,
  types: CardTypes[],
  config: DeepLConfig,
): Promise<GeneratedCards> {
  const [vocab, cloze, character, plot] = await Promise.all([
    types.includes('vocab')     ? generateVocab(chunk, config)     : Promise.resolve([]),
    types.includes('cloze')     ? generateCloze(chunk, config)     : Promise.resolve([]),
    types.includes('character') ? generateCharacter(chunk, config) : Promise.resolve([]),
    types.includes('plot')      ? generatePlot(chunk, config)      : Promise.resolve([]),
  ]);

  return {
    vocab:     vocab     as VocabCard[],
    cloze:     cloze     as ClozeCard[],
    character: character as CharacterCard[],
    plot:      plot      as PlotCard[],
  };
}
