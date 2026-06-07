import { GlobalFreqEntry, CefrLevel } from './types';

const CEFR_ORDER: Record<CefrLevel | 'UNKNOWN', number> = {
  A1: 0, A2: 1, B1: 2, B2: 3, C1: 4, C2: 5, UNKNOWN: 3,
};

export interface CoverageRankResult {
  rankedEntries: GlobalFreqEntry[];
  totalContentTokens: number;
  baselineCoverage: number;         // coverage from words learner already knows (stopwords + A1)
  coverageByCount: number[];        // coverageByCount[i] = coverage when knowing baseline + i+1 words
  recommended95Cutoff: number;      // index (1-based) to reach targetCoverage
}

export function rankByCoverage(
  entries: GlobalFreqEntry[],
  totalTokens: number,
  targetCoverage = 0.95,
  baselineTokens = 0   // tokens from words learner already knows (stopwords + A1)
): CoverageRankResult {
  // Sort by frequency descending; same freq: prefer easier CEFR (more reading impact)
  const sorted = [...entries].sort((a, b) => {
    if (b.globalCount !== a.globalCount) return b.globalCount - a.globalCount;
    return CEFR_ORDER[a.cefrLevel] - CEFR_ORDER[b.cefrLevel];
  });

  const baselineCoverage = totalTokens > 0 ? baselineTokens / totalTokens : 0;
  const coverageByCount: number[] = [];
  let cumulativeTokens = baselineTokens;
  let recommended95Cutoff = sorted.length;

  for (let i = 0; i < sorted.length; i++) {
    cumulativeTokens += sorted[i].globalCount;
    const coverage = totalTokens > 0 ? cumulativeTokens / totalTokens : 0;
    coverageByCount.push(coverage);

    if (coverage >= targetCoverage && recommended95Cutoff === sorted.length) {
      recommended95Cutoff = i + 1;
    }
  }

  return {
    rankedEntries: sorted,
    totalContentTokens: totalTokens,
    baselineCoverage,
    coverageByCount,
    recommended95Cutoff,
  };
}

export function findCutoffIndex(coverageByCount: number[], target: number): number {
  for (let i = 0; i < coverageByCount.length; i++) {
    if (coverageByCount[i] >= target) return i + 1;
  }
  return coverageByCount.length;
}
