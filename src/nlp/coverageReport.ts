import chalk from 'chalk';
import { CoverageRankResult } from './coverageRanker';
import { FilterResult } from './beginnerFilter';

export interface CoverageReport {
  bookTitle: string;
  totalUniqueWords: number;
  totalContentTokens: number;
  baselineCoveragePercent: number;  // coverage from already-known words (stopwords + A1)
  milestones: Array<{ cardsNeeded: number; coveragePercent: number }>;
  recommended95Cutoff: number;
  filterStats: {
    totalBeforeFilter: number;
    rejectedByRule: Record<string, number>;
    finalCandidateCount: number;
  };
}

const MILESTONE_TARGETS = [50, 80, 90, 95, 98];

export function generateCoverageReport(
  bookTitle: string,
  totalUniqueWords: number,
  rankResult: CoverageRankResult,
  filterResult: FilterResult
): CoverageReport {
  const { coverageByCount, recommended95Cutoff, totalContentTokens, rankedEntries, baselineCoverage } = rankResult;

  const milestones = MILESTONE_TARGETS.map(pct => {
    const target = pct / 100;
    const idx = coverageByCount.findIndex(c => c >= target);
    return {
      cardsNeeded: idx === -1 ? rankedEntries.length : idx + 1,
      coveragePercent: pct,
    };
  });

  const rejectedByRule: Record<string, number> = {};
  for (const r of filterResult.rejected) {
    rejectedByRule[r.reason] = (rejectedByRule[r.reason] ?? 0) + 1;
  }

  return {
    bookTitle,
    totalUniqueWords,
    totalContentTokens,
    baselineCoveragePercent: Math.round(baselineCoverage * 100),
    milestones,
    recommended95Cutoff,
    filterStats: {
      totalBeforeFilter: filterResult.kept.length + filterResult.rejected.length,
      rejectedByRule,
      finalCandidateCount: filterResult.kept.length,
    },
  };
}

export function formatCoverageReport(report: CoverageReport): string {
  const bar = '─'.repeat(54);
  const lines: string[] = [];

  lines.push(chalk.cyan(`\n覆蓋率分析：${report.bookTitle}`));
  lines.push(chalk.gray(bar));
  lines.push(`全書有效詞彙：${report.totalUniqueWords.toLocaleString()} unique lemma / ${report.totalContentTokens.toLocaleString()} tokens`);
  lines.push(`基準覆蓋率：${report.baselineCoveragePercent}%（初學者已知的停用詞 + A1 詞彙）`);
  lines.push(chalk.gray(bar));

  for (const m of report.milestones) {
    const isTarget = m.coveragePercent === 95;
    const line = `學 ${String(m.cardsNeeded).padStart(5)} 個字 → 理解 ${m.coveragePercent}%`;
    lines.push(isTarget ? chalk.yellow(line + '  ← 建議截止點') : line);
  }

  lines.push(chalk.gray(bar));
  const { totalBeforeFilter, finalCandidateCount, rejectedByRule } = report.filterStats;
  lines.push(`過濾統計：${totalBeforeFilter.toLocaleString()} → ${finalCandidateCount.toLocaleString()} 個`);
  for (const [rule, count] of Object.entries(rejectedByRule).sort((a, b) => b[1] - a[1])) {
    lines.push(chalk.gray(`  ${rule} 排除：${count.toLocaleString()} 個`));
  }
  lines.push('');

  return lines.join('\n');
}
