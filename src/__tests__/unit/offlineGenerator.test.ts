import { loadOllamaConfig, generateCards, OllamaConfig } from '../../cards/offlineGenerator';
import { EnrichedChunk, EMPTY_CHUNK_NLP } from '../../nlp/types';

const TEST_CHUNK: EnrichedChunk = {
  index: 0,
  text: 'The arduous journey had taken its toll on the weary travellers. Elizabeth walked into the dimly lit corridor, her heart pounding with trepidation.',
  nlp: EMPTY_CHUNK_NLP,
};

// ── loadOllamaConfig ──────────────────────────────────────────────────────────

describe('loadOllamaConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.OLLAMA_MODEL;
    delete process.env.OLLAMA_BASE_URL;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should use CLI model when provided', () => {
    const config = loadOllamaConfig('llama3.1');
    expect(config.model).toBe('llama3.1');
  });

  it('should fall back to OLLAMA_MODEL env variable', () => {
    process.env.OLLAMA_MODEL = 'gemma3';
    const config = loadOllamaConfig();
    expect(config.model).toBe('gemma3');
  });

  it('should use default llama3.2 when nothing is set', () => {
    const config = loadOllamaConfig();
    expect(config.model).toBe('llama3.2');
  });

  it('should use OLLAMA_BASE_URL when set', () => {
    process.env.OLLAMA_BASE_URL = 'http://192.168.1.10:11434';
    const config = loadOllamaConfig();
    expect(config.baseUrl).toBe('http://192.168.1.10:11434');
  });

  it('should use default baseUrl when OLLAMA_BASE_URL is not set', () => {
    const config = loadOllamaConfig();
    expect(config.baseUrl).toBe('http://localhost:11434');
  });

  it('should prefer CLI model over env variable', () => {
    process.env.OLLAMA_MODEL = 'gemma3';
    const config = loadOllamaConfig('mistral');
    expect(config.model).toBe('mistral');
  });
});

// ── callOllama via generateCards (fetch mock) ─────────────────────────────────

const VALID_CONFIG: OllamaConfig = { baseUrl: 'http://localhost:11434', model: 'llama3.2' };

function mockFetchOnce(body: object, status = 200) {
  global.fetch = jest.fn().mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response);
}

function mockFetchError(err: Error) {
  global.fetch = jest.fn().mockRejectedValueOnce(err);
}

describe('generateCards (offline) — fetch mocked', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should return empty arrays for unrequested card types', async () => {
    mockFetchOnce({ message: { content: '{"cards":[{"word":"arduous","definition_zh":"艱難的","exampleFromText":"The arduous journey."}]}' } });

    const result = await generateCards(TEST_CHUNK, ['vocab'], VALID_CONFIG);

    expect(result.cloze).toEqual([]);
    expect(result.character).toEqual([]);
    expect(result.plot).toEqual([]);
    expect(result.vocab.length).toBeGreaterThan(0);
  });

  it('should inject type discriminant into each card', async () => {
    mockFetchOnce({ message: { content: '{"cards":[{"word":"arduous","definition_zh":"艱難的","exampleFromText":"The arduous journey."}]}' } });

    const result = await generateCards(TEST_CHUNK, ['vocab'], VALID_CONFIG);

    expect(result.vocab[0].type).toBe('vocab');
  });

  it('should return empty cards when JSON is malformed and all fallbacks fail', async () => {
    // 三次 fetch 都回傳無法解析的文字（schema → json → regex 全失敗）
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ message: { content: 'not json at all' } }) } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ message: { content: 'still not json' } }) } as unknown as Response);

    const result = await generateCards(TEST_CHUNK, ['vocab'], VALID_CONFIG);
    expect(result.vocab).toEqual([]);
  });

  it('should throw connection error when Ollama is not running', async () => {
    const connErr = Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    connErr.message = 'fetch failed';
    mockFetchError(connErr);

    await expect(generateCards(TEST_CHUNK, ['vocab'], VALID_CONFIG)).rejects.toThrow('無法連線 Ollama');
  });

  it('should throw model not found error when HTTP 404', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({}),
    } as unknown as Response);

    await expect(generateCards(TEST_CHUNK, ['vocab'], VALID_CONFIG)).rejects.toThrow('不存在');
  });

  it('should call fetch sequentially for each requested type', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ message: { content: '{"cards":[]}' } }),
    } as unknown as Response);
    global.fetch = fetchMock;

    await generateCards(TEST_CHUNK, ['vocab', 'cloze', 'character', 'plot'], VALID_CONFIG);

    // 每種類型呼叫一次，共 4 次（循序）
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('should handle abort timeout', async () => {
    jest.useFakeTimers();
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    global.fetch = jest.fn().mockImplementationOnce(() => {
      jest.advanceTimersByTime(61_000);
      return Promise.reject(abortError);
    });

    await expect(generateCards(TEST_CHUNK, ['vocab'], VALID_CONFIG)).rejects.toThrow('逾時');
    jest.useRealTimers();
  });
});
