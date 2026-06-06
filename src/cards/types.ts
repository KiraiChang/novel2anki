export interface Chunk {
  index: number;
  text: string;
  chapter?: string;
}

export interface VocabCard {
  type: 'vocab';
  word: string;
  definition_zh: string;
  exampleFromText: string;
  extraExamples?: string[]; // 同字跨段落的備選例句，供 ai_hint 使用
}

export interface ClozeCard {
  type: 'cloze';
  text: string;
  hint_zh: string;
}

export interface CharacterCard {
  type: 'character';
  name: string;
  description_zh: string;
  firstMention: string;
}

export interface PlotCard {
  type: 'plot';
  question_zh: string;
  answer_zh: string;
}

export type AnyCard = VocabCard | ClozeCard | CharacterCard | PlotCard;

export interface GeneratedCards {
  vocab: VocabCard[];
  cloze: ClozeCard[];
  character: CharacterCard[];
  plot: PlotCard[];
}
