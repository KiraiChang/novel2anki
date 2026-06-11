import { Chunk } from '../cards/types';
import { WordToken } from './types';
import { buildGlobalFreqMap } from './globalFreqAnalyzer';
import { applyBeginnerFilters, FilterOptions, FilterResult } from './beginnerFilter';
import { rankByCoverage, CoverageRankResult } from './coverageRanker';
import { selectBestSentence } from './sentenceScorer';
import { generateCoverageReport, CoverageReport } from './coverageReport';

export interface BeginnerExtractOptions extends FilterOptions {
  targetCoverage?: number;
  normalizeMap?: Map<string, string>;
  onProgress?: (current: number, total: number) => void;
}

export interface BeginnerExtractResult {
  tokens: WordToken[];
  report: CoverageReport;
  filterLog: FilterResult['rejected'];
  rankResult: CoverageRankResult;
}

export function extractBeginnerVocab(
  chunks: Chunk[],
  bookTitle: string,
  options: BeginnerExtractOptions = {}
): BeginnerExtractResult {
  const { targetCoverage = 0.95, normalizeMap, onProgress, ...filterOptions } = options;

  const { freqMap, totalTokens } = buildGlobalFreqMap(chunks, { normalizeMap, onProgress });
  const filterResult = applyBeginnerFilters(freqMap, filterOptions);

  // Baseline coverage: tokens from words a beginner already knows (stopwords + A1 words)
  const alreadyKnownReasons = new Set(['not-stopword', 'not-A1']);
  let baselineTokens = 0;
  for (const r of filterResult.rejected) {
    const entry = freqMap.get(r.lemma);
    if (entry && alreadyKnownReasons.has(r.reason)) {
      baselineTokens += entry.globalCount;
    }
  }

  const rankResult = rankByCoverage(filterResult.kept, totalTokens, targetCoverage, baselineTokens);

  const tokens: WordToken[] = rankResult.rankedEntries.map((entry, i) => {
    const best = selectBestSentence(entry);
    return {
      id: best.id,
      lemma: entry.lemma,
      original: entry.original,
      pos: entry.pos,
      cefrLevel: entry.cefrLevel,
      globalFrequency: entry.globalCount,
      coverageRank: i + 1,
      bestSentence: best.sentence,
      bestSentenceScore: best.score,
      sourceChunkIndex: best.chunkIndex,
      sourceChapter: best.chapter,
      definition_zh: '',
    };
  });

  const report = generateCoverageReport(
    bookTitle,
    freqMap.size,
    rankResult,
    filterResult
  );

  return { tokens, report, filterLog: filterResult.rejected, rankResult };
}
