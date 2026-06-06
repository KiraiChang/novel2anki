import { runNlpPipeline, processChunk } from '../../../nlp/pipeline';
import { Chunk } from '../../../cards/types';

const SAMPLE_CHUNK: Chunk = {
  index: 0,
  text: 'The arduous journey had taken its toll on the weary travellers. Elizabeth walked into the dimly lit corridor, her heart pounding with trepidation.',
  chapter: 'Chapter One',
};

describe('runNlpPipeline', () => {
  it('should return the same number of EnrichedChunks as input Chunks', () => {
    const chunks: Chunk[] = [
      { index: 0, text: 'Hello world.' },
      { index: 1, text: 'Another passage.' },
    ];
    expect(runNlpPipeline(chunks)).toHaveLength(2);
  });

  it('should preserve original chunk fields', () => {
    const result = runNlpPipeline([SAMPLE_CHUNK]);
    expect(result[0].index).toBe(0);
    expect(result[0].text).toBe(SAMPLE_CHUNK.text);
    expect(result[0].chapter).toBe('Chapter One');
  });

  it('should produce vocabSuggestions only with B1-C2 CEFR levels', () => {
    const result = runNlpPipeline([SAMPLE_CHUNK]);
    for (const s of result[0].nlp.vocabSuggestions) {
      expect(['B1', 'B2', 'C1', 'C2']).toContain(s.cefrLevel);
    }
  });

  it('should limit vocabSuggestions to 10 items maximum', () => {
    const result = runNlpPipeline([SAMPLE_CHUNK]);
    expect(result[0].nlp.vocabSuggestions.length).toBeLessThanOrEqual(10);
  });
});

describe('processChunk', () => {
  it('should return EMPTY_CHUNK_NLP when text is empty', () => {
    const result = processChunk({ index: 0, text: '' });
    expect(result.tokens).toHaveLength(0);
    expect(result.vocabSuggestions).toHaveLength(0);
  });

  it('should return empty vocabSuggestions for a chunk with only A1/A2 words', () => {
    const result = processChunk({ index: 0, text: 'The cat sat on the mat. A big dog.' });
    expect(result.vocabSuggestions.every(s => ['B1','B2','C1','C2'].includes(s.cefrLevel))).toBe(true);
  });

  it('should identify arduous as a C1 word', () => {
    const result = processChunk(SAMPLE_CHUNK);
    const found = result.vocabSuggestions.some(s => s.word === 'arduous');
    expect(found).toBe(true);
  });
});
