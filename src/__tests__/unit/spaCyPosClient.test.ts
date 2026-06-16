jest.mock('child_process');
jest.mock('fs');

import { execFile } from 'child_process';
import * as fs from 'fs';
import { batchDetectPos } from '../../nlp/spaCyPosClient';

// venv が存在するように見せる
(fs.existsSync as jest.Mock).mockReturnValue(true);

const mockExecFile = execFile as jest.MockedFunction<typeof execFile>;

function makeChild(stdout: string, stderr = '', error: Error | null = null) {
  const stdinMock = { write: jest.fn(), end: jest.fn() };
  mockExecFile.mockImplementationOnce((_cmd, _args, _opts, cb) => {
    (cb as Function)(error, stdout, stderr);
    return { stdin: stdinMock } as any;
  });
  return stdinMock;
}

beforeEach(() => jest.clearAllMocks());

describe('batchDetectPos', () => {
  it('空陣列直接回傳 []，不呼叫 Python', async () => {
    const result = await batchDetectPos([]);
    expect(result).toEqual([]);
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('Python 成功時回傳解析後的 PosResult 陣列', async () => {
    makeChild(JSON.stringify([
      { word: 'against', pos: 'Preposition' },
      { word: 'run',     pos: 'Verb' },
    ]));
    const result = await batchDetectPos([
      { word: 'against', sentence: 'She put her head against a wall.' },
      { word: 'run',     sentence: 'He runs fast.' },
    ]);
    expect(result).toEqual([
      { word: 'against', pos: 'Preposition' },
      { word: 'run',     pos: 'Verb' },
    ]);
  });

  it('Python 腳本失敗時回傳空陣列（呼叫端 fallback）', async () => {
    makeChild('', '', new Error('spawn error'));
    const result = await batchDetectPos([{ word: 'run', sentence: 'He runs fast.' }]);
    expect(result).toEqual([]);
  });

  it('stdout 非 JSON 時回傳空陣列', async () => {
    makeChild('not-json');
    const result = await batchDetectPos([{ word: 'run', sentence: 'He runs fast.' }]);
    expect(result).toEqual([]);
  });

  it('JSON 輸入透過 stdin 傳入 Python', async () => {
    const stdin = makeChild(JSON.stringify([{ word: 'deep', pos: 'Adjective' }]));
    await batchDetectPos([{ word: 'deep', sentence: 'The water is deep.' }]);
    expect(stdin.write).toHaveBeenCalledWith(
      JSON.stringify([{ word: 'deep', sentence: 'The water is deep.' }]),
    );
    expect(stdin.end).toHaveBeenCalled();
  });
});
