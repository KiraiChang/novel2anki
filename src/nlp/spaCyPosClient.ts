import * as path from 'path';
import * as fs from 'fs';
import { execFile } from 'child_process';

export interface PosRequest {
  word: string;
  sentence: string;
}

export interface PosResult {
  word: string;
  pos: string; // 空字串代表找不到，呼叫端自行 fallback
}

const POS_DIR    = path.resolve(__dirname, '../../scripts/pos');
const POS_SCRIPT = path.join(POS_DIR, 'pos_tagger.py');
const POS_TIMEOUT_MS = 60_000;

function resolveVenvPython(): string {
  const venvDir = path.join(POS_DIR, '.venv');
  const venvPython = process.platform === 'win32'
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python');

  if (fs.existsSync(venvPython)) return venvPython;

  process.stderr.write(
    '[POS] 未找到 venv，請先執行以下指令建立環境：\n' +
    `  python ${path.join(POS_DIR, 'setup.py')}\n` +
    '[POS] Fallback 到 compromise 詞性標記\n',
  );
  return '';
}

/**
 * 批次 POS 標記：呼叫 spaCy Python 腳本，對每個 (word, sentence) 取詞性。
 * venv 未建立或腳本失敗時回傳空陣列，呼叫端退回 compromise fallback。
 */
export async function batchDetectPos(requests: PosRequest[]): Promise<PosResult[]> {
  if (requests.length === 0) return [];

  const python = resolveVenvPython();
  if (!python) return [];

  const input = JSON.stringify(requests);

  return new Promise(resolve => {
    const child = execFile(
      python,
      [POS_SCRIPT],
      { timeout: POS_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (stderr) {
          for (const line of stderr.trim().split('\n')) {
            if (line) process.stderr.write(`[POS] ${line}\n`);
          }
        }

        if (err) {
          process.stderr.write(`[POS] Python 腳本失敗，fallback 到 compromise：${err.message}\n`);
          resolve([]);
          return;
        }

        try {
          resolve(JSON.parse(stdout.trim()) as PosResult[]);
        } catch {
          process.stderr.write('[POS] JSON parse 失敗，fallback 到 compromise\n');
          resolve([]);
        }
      },
    );

    child.stdin?.write(input);
    child.stdin?.end();
  });
}
