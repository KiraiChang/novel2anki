// eslint-disable-next-line @typescript-eslint/no-require-imports
const winkLemmatizer = require('wink-lemmatizer') as {
  verb: (w: string) => string;
  noun: (w: string) => string;
  adjective: (w: string) => string;
};

import { TokenInfo } from './types';

const VERB_POS  = new Set(['Verb', 'Infinitive', 'PastTense', 'Gerund']);
const NOUN_POS  = new Set(['Noun', 'Plural']);
const ADJ_POS   = new Set(['Adjective']);

export function lemmatize(tokens: TokenInfo[]): TokenInfo[] {
  return tokens.map(token => {
    const lower = token.normal.toLowerCase();
    const pos   = token.pos;
    let lemma   = lower;

    if (VERB_POS.has(pos))  lemma = winkLemmatizer.verb(lower)      || lower;
    else if (NOUN_POS.has(pos))  lemma = winkLemmatizer.noun(lower)  || lower;
    else if (ADJ_POS.has(pos))   lemma = winkLemmatizer.adjective(lower) || lower;

    return { ...token, lemma };
  });
}
