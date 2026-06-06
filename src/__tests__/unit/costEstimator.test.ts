import { estimateDeepL, estimateClaude, formatCostReport } from '../../nlp/costEstimator';
import { EnrichedChunk, EMPTY_CHUNK_NLP } from '../../nlp/types';

function makeChunks(count: number, textLen = 800): EnrichedChunk[] {
  return Array.from({ length: count }, (_, i) => ({
    index: i,
    text: 'a'.repeat(textLen),
    nlp: EMPTY_CHUNK_NLP,
  }));
}

describe('estimateDeepL', () => {
  it('should return zero chars for empty chunks', () => {
    const est = estimateDeepL([], ['vocab']);
    expect(est.chars).toBe(0);
    expect(est.freePercent).toBe(0);
    expect(est.proCostUSD).toBe(0);
  });

  it('should scale chars linearly with chunk count', () => {
    const est1 = estimateDeepL(makeChunks(1), ['vocab']);
    const est5 = estimateDeepL(makeChunks(5), ['vocab']);
    expect(est5.chars).toBe(est1.chars * 5);
  });

  it('should increase chars when more types are requested', () => {
    const vocabOnly = estimateDeepL(makeChunks(1), ['vocab']);
    const allTypes  = estimateDeepL(makeChunks(1), ['vocab', 'cloze', 'character', 'plot']);
    expect(allTypes.chars).toBeGreaterThan(vocabOnly.chars);
  });

  it('freePercent should be chars / 500000 * 100', () => {
    const chunks = makeChunks(10);
    const est = estimateDeepL(chunks, ['vocab']);
    expect(est.freePercent).toBeCloseTo((est.chars / 500_000) * 100, 5);
  });

  it('proCostUSD should be chars * 25 / 1_000_000', () => {
    const est = estimateDeepL(makeChunks(3), ['vocab', 'cloze']);
    expect(est.proCostUSD).toBeCloseTo(est.chars * 25 / 1_000_000, 8);
  });
});

describe('estimateClaude', () => {
  it('should return positive token counts for non-empty chunks', () => {
    const est = estimateClaude(makeChunks(2), ['vocab', 'plot']);
    expect(est.inputTokens).toBeGreaterThan(0);
    expect(est.outputTokens).toBeGreaterThan(0);
    expect(est.totalUSD).toBeGreaterThan(0);
  });

  it('should scale with chunk count', () => {
    const est1 = estimateClaude(makeChunks(1), ['vocab']);
    const est3 = estimateClaude(makeChunks(3), ['vocab']);
    expect(est3.inputTokens).toBeGreaterThan(est1.inputTokens);
  });
});

describe('formatCostReport', () => {
  const deepEst  = { chars: 12450, freePercent: 2.49, proCostUSD: 0.000311 };
  const claudeEst = { inputTokens: 15000, outputTokens: 8000, totalUSD: 0.165 };

  it('should include DeepL section', () => {
    const report = formatCostReport(deepEst);
    expect(report).toContain('DeepL');
    expect(report).toContain('12,450');
  });

  it('should include Claude section when provided', () => {
    const report = formatCostReport(deepEst, claudeEst);
    expect(report).toContain('Claude API');
    expect(report).toContain('15,000');
  });

  it('should include Ollama section when model provided', () => {
    const report = formatCostReport(deepEst, undefined, 'llama3.2');
    expect(report).toContain('Ollama');
    expect(report).toContain('llama3.2');
    expect(report).toContain('無額外成本');
  });

  it('should not include Claude section when not provided', () => {
    const report = formatCostReport(deepEst);
    expect(report).not.toContain('Claude API');
  });
});
