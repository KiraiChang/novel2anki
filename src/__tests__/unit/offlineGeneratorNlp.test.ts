import { generateCards, loadOllamaConfig, OllamaConfig } from '../../cards/offlineGenerator';
import { EnrichedChunk, VocabSuggestion, EMPTY_CHUNK_NLP } from '../../nlp/types';

const CONFIG: OllamaConfig = { baseUrl: 'http://localhost:11434', model: 'llama3.2' };

const SUGGESTIONS: VocabSuggestion[] = [
  { word: 'arduous', original: 'arduous', cefrLevel: 'C1', frequency: 2, pos: 'Adjective' },
  { word: 'trepidation', original: 'trepidation', cefrLevel: 'C1', frequency: 1, pos: 'Noun' },
];

function makeEnriched(suggestions: VocabSuggestion[] = SUGGESTIONS): EnrichedChunk {
  return {
    index: 0,
    text: 'The arduous journey had taken its toll. She entered with trepidation.',
    nlp: { tokens: [], vocabSuggestions: suggestions },
  };
}

describe('generateCards (offline) with NLP prompt injection', () => {
  afterEach(() => jest.restoreAllMocks());

  it('should include NLP hint block in vocab prompt when suggestions exist', async () => {
    let capturedBody = '';
    global.fetch = jest.fn().mockImplementation((_url: unknown, init: RequestInit) => {
      capturedBody = init.body as string;
      return Promise.resolve({
        ok: true, status: 200,
        json: async () => ({ message: { content: '{"cards":[]}' } }),
      } as unknown as Response);
    });

    await generateCards(makeEnriched(), ['vocab'], CONFIG);

    const parsed = JSON.parse(capturedBody);
    const userContent = parsed.messages.find((m: {role: string}) => m.role === 'user').content as string;
    expect(userContent).toContain('參考詞彙建議');
    expect(userContent).toContain('arduous');
  });

  it('should not include hint block when vocabSuggestions is empty', async () => {
    let capturedBody = '';
    global.fetch = jest.fn().mockImplementation((_url: unknown, init: RequestInit) => {
      capturedBody = init.body as string;
      return Promise.resolve({
        ok: true, status: 200,
        json: async () => ({ message: { content: '{"cards":[]}' } }),
      } as unknown as Response);
    });

    await generateCards(makeEnriched([]), ['vocab'], CONFIG);

    const parsed = JSON.parse(capturedBody);
    const userContent = parsed.messages.find((m: {role: string}) => m.role === 'user').content as string;
    expect(userContent).not.toContain('參考詞彙建議');
  });

  it('should limit injected suggestions to 8 items', async () => {
    const manySuggestions: VocabSuggestion[] = Array.from({ length: 15 }, (_, i) => ({
      word: `word${i}`, original: `word${i}`, cefrLevel: 'B2', frequency: 1, pos: 'Noun',
    }));

    let capturedBody = '';
    global.fetch = jest.fn().mockImplementation((_url: unknown, init: RequestInit) => {
      capturedBody = init.body as string;
      return Promise.resolve({
        ok: true, status: 200,
        json: async () => ({ message: { content: '{"cards":[]}' } }),
      } as unknown as Response);
    });

    await generateCards(makeEnriched(manySuggestions), ['vocab'], CONFIG);

    const parsed = JSON.parse(capturedBody);
    const userContent = parsed.messages.find((m: {role: string}) => m.role === 'user').content as string;
    const matches = (userContent.match(/^- /gm) ?? []).length;
    expect(matches).toBeLessThanOrEqual(8);
  });
});
