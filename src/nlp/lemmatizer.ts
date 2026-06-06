import nlp from 'compromise';
import { TokenInfo } from './types';

function verbLemma(word: string): string {
  const result = nlp(word).verbs().toInfinitive().out('text').toLowerCase().trim();
  return result || word;
}

function nounLemma(word: string): string {
  const result = nlp(word).nouns().toSingular().out('text').toLowerCase().trim();
  return result || word;
}

export function lemmatize(tokens: TokenInfo[]): TokenInfo[] {
  return tokens.map(token => {
    let lemma = token.normal;
    const pos = token.pos;

    if (pos === 'Verb' || pos === 'Infinitive' || pos === 'PastTense' || pos === 'Gerund') {
      lemma = verbLemma(token.original);
    } else if (pos === 'Noun' || pos === 'Plural') {
      lemma = nounLemma(token.original);
    }
    // Adjective / Adverb / 其他：直接使用 normal

    return { ...token, lemma };
  });
}
