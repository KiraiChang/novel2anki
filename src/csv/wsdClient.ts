import * as path from 'path';
import * as fs from 'fs';
import { execFile } from 'child_process';

export interface WsdRequest {
  word: string;
  shortdefs: string[];
  sentence: string;
}

export interface WsdResult {
  word: string;
  chosenIndex: number;
  score: number;
}

const WSD_DIR    = path.resolve(__dirname, '../../scripts/wsd');
const WSD_SCRIPT = path.join(WSD_DIR, 'glossbert_wsd.py');
const WSD_TIMEOUT_MS = 180_000; // 模型首次下載時間較長，給 3 分鐘

/** venv Python 執行檔路徑（Windows / Unix）*/
function resolveVenvPython(): string {
  const venvDir = path.join(WSD_DIR, '.venv');
  const venvPython = process.platform === 'win32'
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python');

  if (fs.existsSync(venvPython)) return venvPython;

  // venv 尚未建立，印出設定說明後 fallback 到系統 Python
  process.stderr.write(
    '[WSD] 未找到 venv，請先執行以下指令建立環境：\n' +
    `  cd ${WSD_DIR}\n` +
    '  python -m venv .venv\n' +
    (process.platform === 'win32'
      ? '  .venv\\Scripts\\pip install -r requirements.txt\n'
      : '  .venv/bin/pip install -r requirements.txt\n') +
    '[WSD] Fallback 到系統 Python（sentence-transformers 若未安裝將再次 fallback 到 index 0）\n',
  );
  return process.platform === 'win32' ? 'python' : 'python3';
}

/**
 * 批次 WSD 推論：呼叫 Python 腳本，依 context_sentence 從多個 shortdefs 中選出最符合語境的詞義。
 * venv 未建立或腳本執行失敗時，回傳全 chosenIndex: 0 的 fallback 結果並印出警告。
 */
export async function batchWsd(requests: WsdRequest[]): Promise<WsdResult[]> {
  if (requests.length === 0) return [];

  const input = JSON.stringify(requests);

  return new Promise(resolve => {
    const python = resolveVenvPython();

    const child = execFile(
      python,
      [WSD_SCRIPT],
      { timeout: WSD_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (stderr) {
          for (const line of stderr.trim().split('\n')) {
            if (line) process.stderr.write(`${line}\n`);
          }
        }

        if (err) {
          process.stderr.write(`[WSD] Python 腳本失敗，fallback 到 index 0：${err.message}\n`);
          resolve(requests.map(r => ({ word: r.word, chosenIndex: 0, score: 0 })));
          return;
        }

        try {
          const parsed = JSON.parse(stdout.trim()) as WsdResult[];
          // 對齊 key 名稱（Python 輸出 chosen_index，需轉換）
          const normalized = parsed.map(p => ({
            word: p.word,
            chosenIndex: (p as unknown as { chosen_index?: number }).chosen_index ?? p.chosenIndex ?? 0,
            score: p.score ?? 0,
          }));
          resolve(normalized);
        } catch {
          process.stderr.write('[WSD] JSON parse 失敗，fallback 到 index 0\n');
          resolve(requests.map(r => ({ word: r.word, chosenIndex: 0, score: 0 })));
        }
      },
    );

    child.stdin?.write(input);
    child.stdin?.end();
  });
}
