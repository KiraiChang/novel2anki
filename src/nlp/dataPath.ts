import * as fs from 'fs';
import * as path from 'path';

const BUNDLED_DIR = path.join(__dirname, '../data');

/**
 * Resolve the path to a named data file.
 *
 * Lookup order:
 *   1. $WORD_CACHE_PATH/<name>  — external data directory (set in .env)
 *   2. src/data/<name>           — bundled fallback (for tests / offline use)
 *
 * If neither location has the file the bundled path is returned anyway so that
 * downstream callers receive a readable error ("file not found") instead of a
 * silent wrong path.
 */
export function resolveDataPath(name: string): string {
  const envDir = process.env['WORD_CACHE_PATH'];
  if (envDir) {
    const candidate = path.resolve(envDir, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.join(BUNDLED_DIR, name);
}
