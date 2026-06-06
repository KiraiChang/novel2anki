import { EnrichedChunk } from './types';
import { CardTypes } from '../cards/generator';

// DeepL Pro: ~$25/1M chars；Free tier: 500,000 chars/month
const DEEPL_FREE_MONTHLY = 500_000;
const DEEPL_PRO_PER_CHAR = 25 / 1_000_000;

// Claude Sonnet 4.6 pricing (USD/1M tokens)
const CLAUDE_INPUT_PER_TOKEN = 3 / 1_000_000;
const CLAUDE_OUTPUT_PER_TOKEN = 15 / 1_000_000;

// 每個卡片類型預計送 DeepL 翻譯的平均英文字元數
const DEEPL_CHARS_PER_CHUNK: Record<CardTypes, number> = {
  vocab:     4 * 110,   // 4 字 × 平均 110 字元定義
  cloze:     2 * 45,    // 2 張 × 45 字元 hint
  character: 2 * 160,   // 2 個人物 × 160 字元描述
  plot:      1 * 260,   // 1 張 × 260 字元摘要
};

// 每個卡片類型 Claude 平均 token 用量（input / output）
const CLAUDE_TOKENS_PER_CHUNK: Record<CardTypes, { input: number; output: number }> = {
  vocab:     { input: 600,  output: 500  },
  cloze:     { input: 600,  output: 400  },
  character: { input: 500,  output: 500  },
  plot:      { input: 500,  output: 600  },
};

export interface DeepLEstimate {
  chars: number;
  freePercent: number;
  proCostUSD: number;
}

export interface ClaudeEstimate {
  inputTokens: number;
  outputTokens: number;
  totalUSD: number;
}

export function estimateDeepL(chunks: EnrichedChunk[], types: CardTypes[]): DeepLEstimate {
  const charsPerChunk = types.reduce((s, t) => s + (DEEPL_CHARS_PER_CHUNK[t] ?? 0), 0);
  const chars = charsPerChunk * chunks.length;
  return {
    chars,
    freePercent: (chars / DEEPL_FREE_MONTHLY) * 100,
    proCostUSD: chars * DEEPL_PRO_PER_CHAR,
  };
}

export function estimateClaude(chunks: EnrichedChunk[], types: CardTypes[]): ClaudeEstimate {
  // 段落文字本身也計入 input tokens（每 4 字元 ≈ 1 token）
  const avgChunkTokens = chunks.reduce((s, c) => s + Math.round(c.text.length / 4), 0) / chunks.length;
  let inputTokens = 0;
  let outputTokens = 0;
  for (const t of types) {
    const base = CLAUDE_TOKENS_PER_CHUNK[t];
    inputTokens  += (base.input + avgChunkTokens) * chunks.length;
    outputTokens += base.output * chunks.length;
  }
  return {
    inputTokens: Math.round(inputTokens),
    outputTokens: Math.round(outputTokens),
    totalUSD: inputTokens * CLAUDE_INPUT_PER_TOKEN + outputTokens * CLAUDE_OUTPUT_PER_TOKEN,
  };
}

export function formatCostReport(
  deepl: DeepLEstimate,
  claude?: ClaudeEstimate,
  ollamaModel?: string,
): string {
  const lines: string[] = [
    '┌─────────────────────────────────────────────────────┐',
    '│  成本預估（正式執行前）                               │',
    '├─────────────────────────────────────────────────────┤',
    '│  DeepL 翻譯                                         │',
    `│    預計翻譯字元：  ${deepl.chars.toLocaleString().padEnd(10)} 字元              │`,
    `│    Free 額度佔用： ${deepl.freePercent.toFixed(1).padEnd(6)}%（上限 500,000 字元/月）  │`,
    `│    Pro  費用估算： ~$${deepl.proCostUSD.toFixed(4)} USD                   │`,
  ];

  if (claude) {
    lines.push(
      '├─────────────────────────────────────────────────────┤',
      '│  比對模式：Claude API                               │',
      `│    預計輸入 token： ${claude.inputTokens.toLocaleString().padEnd(10)}              │`,
      `│    預計輸出 token： ${claude.outputTokens.toLocaleString().padEnd(10)}              │`,
      `│    費用估算：       ~$${claude.totalUSD.toFixed(4)} USD               │`,
    );
  }

  if (ollamaModel) {
    lines.push(
      '├─────────────────────────────────────────────────────┤',
      `│  比對模式：Ollama (${ollamaModel.padEnd(30)})│`,
      '│    費用：本機推理，無額外成本                         │',
    );
  }

  lines.push('└─────────────────────────────────────────────────────┘');
  return lines.join('\n');
}
