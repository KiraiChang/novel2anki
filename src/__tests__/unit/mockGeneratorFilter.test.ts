import { generateMockCards } from '../../cards/mockGenerator';
import { EnrichedChunk, EMPTY_CHUNK_NLP } from '../../nlp/types';

// 混入版權聲明的文字
const MIXED_TEXT =
  'Copyright © 2023 Some Publisher. All rights reserved. ' +
  'No part of this publication may be reproduced without permission. ' +
  'ISBN 978-0-00-000000-0. First published in 2023 by Some Press. ' +
  'The arduous journey had taken its toll on the weary travellers. ' +
  'She entered the room with trepidation, unsure of what she would find inside. ' +
  'He struggled against the fierce current to reach the distant shore beyond the reef.';

function makeChunk(text: string): EnrichedChunk {
  return { index: 0, text, nlp: EMPTY_CHUNK_NLP };
}

describe('extractSentences — non-story filtering', () => {
  it('should not use copyright sentences as example sentences', () => {
    const cards = generateMockCards(makeChunk(MIXED_TEXT), ['vocab']);
    for (const card of cards.vocab) {
      expect(card.exampleFromText.toLowerCase()).not.toContain('copyright');
      expect(card.exampleFromText).not.toContain('©');
      expect(card.exampleFromText.toLowerCase()).not.toContain('all rights reserved');
      expect(card.exampleFromText.toLowerCase()).not.toContain('isbn');
    }
  });

  it('should not use publisher info sentences as example sentences', () => {
    const cards = generateMockCards(makeChunk(MIXED_TEXT), ['vocab']);
    for (const card of cards.vocab) {
      expect(card.exampleFromText.toLowerCase()).not.toContain('published by');
      expect(card.exampleFromText.toLowerCase()).not.toContain('first published');
    }
  });

  it('should still extract story sentences when available', () => {
    const cards = generateMockCards(makeChunk(MIXED_TEXT), ['cloze']);
    // cloze 卡片的文字應來自故事句，不含版權資訊
    for (const card of cards.cloze) {
      expect(card.text.toLowerCase()).not.toContain('copyright');
      expect(card.text.toLowerCase()).not.toContain('isbn');
    }
  });

  it('should filter sentences containing http/www URLs', () => {
    const withUrl =
      'Visit us at https://example.com for more information about this book. ' +
      'The arduous path wound through the mountains for many long and weary miles.';
    const cards = generateMockCards(makeChunk(withUrl), ['vocab']);
    for (const card of cards.vocab) {
      expect(card.exampleFromText).not.toContain('https://');
    }
  });
});
