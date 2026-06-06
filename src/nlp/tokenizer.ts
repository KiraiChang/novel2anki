import nlp from 'compromise';
import { TokenInfo } from './types';

interface CompromiseTerm {
  text: string;
  normal: string;
  tags: string[];
}

interface CompromisePhrase {
  terms: CompromiseTerm[];
}

export function tokenize(cleanedText: string): TokenInfo[] {
  const doc = nlp(cleanedText);
  const phrases = doc.terms().json() as CompromisePhrase[];

  const tokens: TokenInfo[] = [];
  for (const phrase of phrases) {
    for (const term of phrase.terms) {
      const normal = term.normal ?? term.text.toLowerCase();
      // 只保留含英文字母的 token（跳過純標點、數字）
      if (!/[a-z]/i.test(normal)) continue;

      tokens.push({
        original: term.text,
        normal,
        lemma: normal, // 先填 normal，lemmatizer 再修正
        pos: term.tags?.[0] ?? 'Unknown',
      });
    }
  }
  return tokens;
}
