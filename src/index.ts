import 'dotenv/config';
import * as readline from 'readline';
import { Command } from 'commander';
import chalk from 'chalk';
import * as path from 'path';
import { extractChunks as extractPdf } from './pdf/extractor';
import { extractChunks as extractEpub } from './epub/extractor';
import { generateCards, CardTypes } from './cards/generator';
import { generateMockCards } from './cards/mockGenerator';
import { generateReadingMockCards } from './cards/readingMockGenerator';
import { generateReadingCards } from './cards/readingGenerator';
import { generateReadingOfflineCards } from './cards/readingOfflineGenerator';
import { exportReadingToCsv, exportReadingToCsvSplits } from './csv/readingExporter';
import { exportReadingToHtml } from './html/readingExporter';
import { generateCards as generateOfflineCards, loadOllamaConfig } from './cards/offlineGenerator';
import { generateDeepLCards } from './cards/deeplGenerator';
import { loadDeepLConfig } from './cards/deeplTranslator';
import { exportToApkg } from './anki/exporter';
import { exportToHtml, exportToFlashHtml, exportReadingToFlashHtml, exportToComparisonHtml } from './html/exporter';
import { exportBeginnerStatsToHtml } from './html/beginnerStatsExporter';
import { exportToCsv, exportToCsvSplits, ChunkResult, scoreMention } from './csv/exporter';
import { importFromCsv, importFromCsvFiles, resolveCsvPaths } from './csv/importer';
import { extractBeginnerVocab } from './nlp/beginnerExtractor';
import { formatCoverageReport } from './nlp/coverageReport';
import { exportBeginnerTokensToCsv, exportBeginnerWordsToCsv, exportBeginnerWordsSplit, exportBeginnerNamesFile } from './csv/beginnerExporter';
import { loadNamesFile } from './nlp/nameProtector';
import { importBeginnerTokens, mergeTokensToVocabCards, isBeginnerCsv, isBeginnerWordsCsv, importBeginnerWords, importBeginnerWordsFromFiles, computeBeginnerWordStats } from './csv/beginnerImporter';
import { estimateBeginnerTranslate, formatBeginnerTranslateEstimate, translateBeginnerWordsCsv, fetchBeginnerWordsMW, estimateMWFetch, updateWordDictFromCsv } from './csv/beginnerDeeplTranslator';
import { getWordCache } from './nlp/wordCache';
import * as fs from 'fs';
import { GeneratedCards } from './cards/types';
import { runNlpPipeline, processChunk } from './nlp/pipeline';
import { EnrichedChunk, EMPTY_CHUNK_NLP } from './nlp/types';
import { estimateDeepL, estimateClaude, formatCostReport } from './nlp/costEstimator';

const VALID_TYPES: CardTypes[] = ['vocab', 'cloze', 'character', 'plot'];

const program = new Command();

program
  .name('novel2anki')
  .description('從英文 PDF / EPUB 小說自動產生 Anki 字卡')
  .version('1.0.0')
  .argument('<file>', 'PDF 或 EPUB 檔案路徑')
  .option('-d, --deck <名稱>', '牌組名稱（預設：PDF 檔名）')
  .option('-t, --types <類型>', '字卡類型，以逗號分隔：vocab,cloze,character,plot', 'vocab,cloze,character,plot')
  .option('-c, --chunks <數量>', '最多處理幾個區塊（預設：全部）')
  .option('-o, --output <目錄>', '輸出目錄', './output')
  .option('--mock', '模擬模式：不呼叫 API，用簡單文字分析產生測試字卡')
  .option('--offline', '離線模式：使用本機 Ollama 產生字卡（需先啟動 Ollama）')
  .option('--model <模型名稱>', '指定 Ollama 模型（預設：llama3.2，也可設定 OLLAMA_MODEL 環境變數）')
  .option('--deepl', '使用 DeepL API 翻譯定義（需設定 DEEPL_API_KEY）')
  .option('--deepl-force', '強制重新翻譯（即使 CSV 已有翻譯內容也全部覆寫）')
  .option('--split-chapters', '將 CSV 依章節分割輸出（mock 模式）')
  .option('--split-size <數量>', '將 CSV 依每 N 個 chunk 分割輸出（mock 模式）')
  .option('--reading', '讀書理解模式：產出術語、因果、章節脈絡、主題意象字卡')
  .option('--flash', '額外輸出單字卡 HTML（頁籤切換 + 上一張 / 下一張 + 翻面）')
  .option('--beginner', '初學者模式：掃描全書，擷取達目標覆蓋率所需詞彙，輸出逐詞 CSV 供翻譯後合併成字卡')
  .option('--beginner-target <百分比>', '覆蓋率目標，0-100（預設：95）', '95')
  .option('--beginner-min-freq <次數>', '詞彙最低出現次數門檻（預設：2）', '2')
  .option('--beginner-include-a1', '包含 A1 基礎詞彙（預設：排除）')
  .option('--beginner-split <數量>', '將翻譯 CSV 分割為每 N 個詞彙一個檔案')
  .option('--mw', 'MW 預查模式：預先擷取 Merriam-Webster 英文定義並寫入 CSV（設定 MW_API_KEY 時使用付費版；未設定則 fallback 免費字典）')
  .option('--update-dict', '將 CSV 中已填寫的 definition_en 升級到個人單字庫（word-dict.json），未來所有書優先使用')
  .action(async (pdfFile: string, options: { // pdfFile = general input file (pdf, epub, csv or directory)
    deck?: string;
    types: string;
    chunks?: string;
    output: string;
    mock?: boolean;
    offline?: boolean;
    model?: string;
    deepl?: boolean;
    deeplForce?: boolean;
    splitChapters?: boolean;
    splitSize?: string;
    reading?: boolean;
    flash?: boolean;
    beginner?: boolean;
    beginnerTarget?: string;
    beginnerMinFreq?: string;
    beginnerIncludeA1?: boolean;
    beginnerSplit?: string;
    mw?: boolean;
    updateDict?: boolean;
  }) => {
    const needsApiKey = !options.mock && !options.offline && !options.deepl && !options.deeplForce && !options.mw && !options.updateDict;
    if (needsApiKey && !process.env.ANTHROPIC_API_KEY) {
      console.error(chalk.red('錯誤：請設定環境變數 ANTHROPIC_API_KEY，或加上 --mock / --offline / --deepl / --deepl-force 旗標以不使用 Claude API'));
      process.exit(1);
    }

    const requestedTypes = options.types.split(',').map(t => t.trim()) as CardTypes[];
    const invalidTypes = requestedTypes.filter(t => !VALID_TYPES.includes(t));
    if (invalidTypes.length > 0) {
      console.error(chalk.red(`錯誤：無效的字卡類型：${invalidTypes.join(', ')}`));
      process.exit(1);
    }

    const deckName = options.deck ?? path.basename(pdfFile, path.extname(pdfFile));
    const maxChunks = options.chunks ? parseInt(options.chunks, 10) : Infinity;

    const ollamaConfig = options.offline ? loadOllamaConfig(options.model) : null;
    const deeplConfig  = options.deepl   ? loadDeepLConfig()               : null;

    // 比對模式：--deepl + Claude API 或 --deepl + --offline
    const isCompare = options.deepl && (options.offline || (!options.mock && process.env.ANTHROPIC_API_KEY));

    console.log(chalk.cyan(`\n📖 PDF 小說 → Anki 字卡產生器`));
    if (options.mock)   console.log(chalk.yellow('   [模擬模式：不使用 AI API]'));
    if (options.offline) console.log(chalk.yellow(`   [離線模式：Ollama ${ollamaConfig!.model}]`));
    if (options.updateDict) console.log(chalk.magenta('   [個人單字庫升級模式]'));
    if (options.mw && !options.deepl && !options.deeplForce) console.log(chalk.green('   [MW 預查模式]'));
    if (options.mw && (options.deepl || options.deeplForce)) console.log(chalk.green('   [MW 預查 + DeepL 翻譯模式]'));
    if (options.deepl && !isCompare) console.log(chalk.blue('   [DeepL 翻譯模式]'));
    if (isCompare) console.log(chalk.blue(`   [DeepL 比對模式：DeepL vs ${options.offline ? `Ollama ${ollamaConfig!.model}` : 'Claude API'}]`));
    console.log(chalk.gray(`   牌組：${deckName}`));
    console.log(chalk.gray(`   字卡類型：${requestedTypes.join(', ')}`));
    console.log('');

    const isDirectory = (() => { try { return fs.statSync(pdfFile).isDirectory(); } catch { return false; } })();
    const ext = path.extname(pdfFile).toLowerCase();

    // CSV / 目錄輸入模式：解析後直接匯出，跳過提取與生成步驟
    if (isDirectory || ext === '.csv') {
      const csvPaths = resolveCsvPaths(pdfFile);
      if (csvPaths.length === 0) {
        console.error(chalk.red('錯誤：找不到任何 CSV 檔案。'));
        process.exit(1);
      }

      // 初學者翻譯 CSV（含 context_sentence 欄位）：單檔或分割多檔皆支援
      // 目錄中可能同時含有 tokens.csv，過濾出 words 類型即可
      const beginnerWordsCsvs = csvPaths.filter(p => isBeginnerWordsCsv(p));
      if (beginnerWordsCsvs.length > 0) {
        // 個人單字庫升級：把 CSV 的 definition_en 升級到 word-dict.json
        if (options.updateDict) {
          const wc = getWordCache();
          console.log('');
          console.log(chalk.magenta(`個人單字庫升級（${wc.dictFilePath}）`));
          for (const csvPath of beginnerWordsCsvs) {
            process.stdout.write(chalk.yellow(`正在讀取 ${path.basename(csvPath)}...\n`));
            const result = await updateWordDictFromCsv(csvPath, (cur, total, word) => {
              process.stdout.write(chalk.yellow(`\r  升級中... ${cur}/${total}  ${word ?? ''}   `));
            });
            process.stdout.write(`\r${chalk.green(`  ✓ 完成：升級 ${result.updatedCount} 個，跳過 ${result.skippedCount} 個`)}\n`);
          }
          console.log('');
          console.log(chalk.magenta(`word-dict.json：${getWordCache().dictSize} 筆`));
          console.log(chalk.gray(`  路徑：${getWordCache().dictFilePath}`));
          return;
        }

        // MW 預查：預先擷取英文定義並寫入 definition_en 欄（可單獨或搭配 --deepl）
        if (options.mw) {
          const { unfetchedCount } = estimateMWFetch(beginnerWordsCsvs);
          console.log('');
          console.log(chalk.cyan(`MW 預查：共 ${unfetchedCount} 個詞彙待預查`));
          if (unfetchedCount === 0) {
            console.log(chalk.yellow('  所有詞彙已預查完畢（definition_en 欄位已填）。'));
          } else {
            for (const csvPath of beginnerWordsCsvs) {
              process.stdout.write(chalk.yellow(`正在預查 ${path.basename(csvPath)}...\n`));
              const mwResult = await fetchBeginnerWordsMW(csvPath, (cur, total, meta) => {
                const sourceTag = meta?.source === 'dict' ? chalk.magenta('[字典]') : meta?.source === 'MW' ? chalk.green('[MW]') : meta?.source === 'free' ? chalk.gray('[Free]') : meta?.source === 'cached' ? chalk.blue('[快取]') : chalk.red('[fallback]');
                process.stdout.write(chalk.yellow(`\r  取得英文定義... ${cur}/${total}  `) + ` ${sourceTag} ${meta?.word ?? ''}   `);
              });
              process.stdout.write(`\r${chalk.green(`  ✓ 完成：預查 ${mwResult.fetchedCount} 個，跳過 ${mwResult.skippedCount} 個`)}\n`);
            }
          }
          console.log('');
          if (!options.deepl && !options.deeplForce) {
            console.log(chalk.cyan('MW 預查完成。definition_en 欄位已寫入 CSV。'));
            console.log(chalk.cyan('下一步：執行以下指令進行 DeepL 翻譯：'));
            const outputDir = isDirectory ? pdfFile : path.dirname(beginnerWordsCsvs[0]);
            console.log(chalk.white(`  npx ts-node src/index.ts ${outputDir} -d "${deckName}" --deepl`));
            return;
          }
          // --mw --deepl：繼續執行下方 DeepL 流程
        }

        // DeepL 自動翻譯：翻譯後覆寫 CSV 並退出，不產生 APKG/HTML
        // 使用者等所有分割檔翻譯完畢後再整目錄合併產出字卡
        if (options.deepl || options.deeplForce) {
          const deeplCfg = loadDeepLConfig();
          const force = !!options.deeplForce;
          const est = estimateBeginnerTranslate(beginnerWordsCsvs, { force });
          console.log('');
          if (force) console.log(chalk.magenta('⚡ 強制重新翻譯模式（--deepl-force）'));
          console.log(chalk.cyan(formatBeginnerTranslateEstimate(est)));

          // 已全部翻譯且非強制模式：阻斷並提示清除方式
          if (!force && est.untranslatedCount === 0) {
            console.log(chalk.yellow('⚠ 此 CSV 已完整翻譯，無法重複提交。'));
            console.log(chalk.gray('  若需重新翻譯，請加上 --deepl-force 強制覆寫，'));
            console.log(chalk.gray('  或手動清除 CSV 中 definition_zh / context_sentence_zh 欄位後再執行。'));
            process.exit(1);
          }

          const confirmed = await new Promise<boolean>(resolve => {
            const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
            rl.question(chalk.bold('是否繼續 DeepL 翻譯？[Y/n] '), ans => {
              rl.close();
              resolve(ans.trim().toLowerCase() !== 'n');
            });
          });
          if (!confirmed) { console.log(chalk.gray('已取消。')); process.exit(0); }
          console.log('');

          // 嘗試讀取預建人名表（與 CSV 同目錄的 *-beginner-names.txt）
          const csvDir = path.dirname(beginnerWordsCsvs[0]);
          const namesFilesInDir = fs.readdirSync(csvDir).filter(f => f.endsWith('-beginner-names.txt'));
          const prebuiltNamesForBatch = namesFilesInDir.length > 0
            ? loadNamesFile(path.join(csvDir, namesFilesInDir[0]))
            : undefined;
          if (prebuiltNamesForBatch) {
            console.log(chalk.gray(`  使用預建人名表（${prebuiltNamesForBatch.size} 個名詞）：${namesFilesInDir[0]}`));
          }

          for (const csvPath of beginnerWordsCsvs) {
            process.stdout.write(chalk.yellow(`正在翻譯 ${path.basename(csvPath)}...\n`));
            const result = await translateBeginnerWordsCsv(csvPath, deeplCfg, (cur, total, phase, meta) => {
              if (phase === 'dict') {
                const sourceTag = meta?.source === 'dict' ? chalk.magenta('[字典]') : meta?.source === 'MW' ? chalk.green('[MW]') : meta?.source === 'free' ? chalk.gray('[Free]') : meta?.source === 'cached' ? chalk.blue('[快取]') : chalk.red('[fallback]');
                process.stdout.write(chalk.yellow(`\r  取得英文定義... ${cur}/${total}  `) + ` ${sourceTag} ${meta?.word ?? ''}   `);
              } else {
                const label = phase === 'deepl' ? 'DeepL 翻譯' : '寫入';
                process.stdout.write(chalk.yellow(`\r  ${label}... ${cur}/${total}   `));
              }
            }, { force, prebuiltNames: prebuiltNamesForBatch });
            process.stdout.write(`\r${chalk.green(`  ✓ 完成：翻譯 ${result.translatedCount} 個，跳過 ${result.skippedCount} 個`)}\n`);
          }

          console.log('');
          const outputDir = isDirectory ? pdfFile : path.dirname(beginnerWordsCsvs[0]);
          console.log(chalk.cyan('翻譯已寫回 CSV。所有分割檔翻譯完成後，執行以下指令產生字卡：'));
          console.log(chalk.white(`  npx ts-node src/index.ts ${outputDir} -d "${deckName}" --flash`));
          return;
        }

        if (beginnerWordsCsvs.length > 1) {
          console.log(chalk.yellow(`正在合併 ${beginnerWordsCsvs.length} 個初學者翻譯 CSV...`));
          beginnerWordsCsvs.forEach((p, i) => console.log(chalk.gray(`  ${i + 1}. ${p}`)));
        } else {
          console.log(chalk.yellow(`正在讀取初學者翻譯 CSV：${beginnerWordsCsvs[0]}`));
        }
        const vocabCards = beginnerWordsCsvs.length > 1
          ? importBeginnerWordsFromFiles(beginnerWordsCsvs)
          : importBeginnerWords(beginnerWordsCsvs[0]);
        if (vocabCards.length === 0) {
          console.error(chalk.red('錯誤：CSV 中沒有任何詞彙。'));
          process.exit(1);
        }

        // 字彙統計
        const bwStats = computeBeginnerWordStats(beginnerWordsCsvs);
        const translatedPct = bwStats.total > 0 ? Math.round(bwStats.translated / bwStats.total * 100) : 0;
        const CEFR_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'UNKNOWN'];
        const statSep = chalk.gray('─'.repeat(40));
        console.log('');
        console.log(chalk.cyan('字彙統計'));
        console.log(statSep);
        console.log(`詞彙總數：   ${bwStats.total.toLocaleString()} 個`);
        console.log(`已翻譯：     ${chalk.green(bwStats.translated.toLocaleString())} 個（${translatedPct}%）`);
        if (bwStats.total - bwStats.translated > 0) {
          console.log(`未翻譯：     ${chalk.yellow((bwStats.total - bwStats.translated).toLocaleString())} 個（定義欄位空白）`);
        }
        console.log(statSep);
        console.log('CEFR 分佈：');
        for (const level of CEFR_ORDER) {
          const cnt = bwStats.cefrDist[level];
          if (!cnt) continue;
          const pct = Math.round(cnt / bwStats.total * 100);
          console.log(`  ${level.padEnd(8)}${cnt.toString().padStart(5)} 個（${pct}%）`);
        }
        if (bwStats.rankMax > 0) {
          console.log(statSep);
          console.log(`覆蓋率排名：#${bwStats.rankMin} – #${bwStats.rankMax}`);
        }
        const statsHtmlPath = exportBeginnerStatsToHtml(bwStats, deckName, options.output);
        console.log(chalk.green(`✓ 字彙統計 HTML：${statsHtmlPath}`));

        const csvCards: GeneratedCards = { vocab: vocabCards, cloze: [], character: [], plot: [] };
        console.log('');
        console.log(chalk.yellow('正在匯出檔案...'));
        const apkgPath = await exportToApkg(csvCards, deckName, options.output);
        const htmlPath = exportToHtml(csvCards, deckName, options.output);
        console.log(chalk.green(`✓ Anki 匯入包：${apkgPath}`));
        console.log(chalk.green(`✓ HTML 預覽：  ${htmlPath}`));
        if (options.flash) {
          const flashPath = exportToFlashHtml(csvCards, deckName, options.output);
          console.log(chalk.green(`✓ 單字卡 HTML：${flashPath}`));
        }
        console.log('');
        console.log(chalk.cyan('· 匯入 Anki：開啟 Anki → 檔案 → 匯入，選取 .apkg 檔案'));
        console.log(chalk.cyan('· 直接預覽：用瀏覽器開啟 .html 檔案'));
        return;
      }

      // 初學者字彙 CSV（含 token_id 欄位）：合併翻譯後轉為 VocabCard
      if (csvPaths.length === 1 && isBeginnerCsv(csvPaths[0])) {
        console.log(chalk.yellow(`正在讀取初學者字彙 CSV：${csvPaths[0]}`));
        const tokens = importBeginnerTokens(csvPaths[0]);
        const translated = tokens.filter(t => t.definition_zh.trim().length > 0);
        console.log(chalk.green(`✓ 共讀取 ${tokens.length} 個詞彙，已翻譯 ${translated.length} 個`));
        if (translated.length === 0) {
          console.error(chalk.red('錯誤：CSV 中沒有已填入 definition_zh 的詞彙。'));
          process.exit(1);
        }
        const vocabCards = mergeTokensToVocabCards(tokens);
        const csvCards: GeneratedCards = { vocab: vocabCards, cloze: [], character: [], plot: [] };
        console.log('');
        console.log(chalk.yellow('正在匯出檔案...'));
        const apkgPath = await exportToApkg(csvCards, deckName, options.output);
        const htmlPath = exportToHtml(csvCards, deckName, options.output);
        console.log(chalk.green(`✓ Anki 匯入包：${apkgPath}`));
        console.log(chalk.green(`✓ HTML 預覽：  ${htmlPath}`));
        if (options.flash) {
          const flashPath = exportToFlashHtml(csvCards, deckName, options.output);
          console.log(chalk.green(`✓ 單字卡 HTML：${flashPath}`));
        }
        console.log('');
        console.log(chalk.cyan('· 匯入 Anki：開啟 Anki → 檔案 → 匯入，選取 .apkg 檔案'));
        console.log(chalk.cyan('· 直接預覽：用瀏覽器開啟 .html 檔案'));
        return;
      }

      console.log(chalk.yellow(`正在讀取 ${csvPaths.length} 個 CSV...`));
      csvPaths.forEach((p, i) => console.log(chalk.gray(`  ${i + 1}. ${p}`)));
      const csvCards = importFromCsvFiles(csvPaths);
      const total = csvCards.vocab.length + csvCards.cloze.length + csvCards.character.length + csvCards.plot.length;
      console.log(chalk.green(`✓ 共讀取 ${total} 張卡片（詞彙 ${csvCards.vocab.length}、克漏字 ${csvCards.cloze.length}、人物 ${csvCards.character.length}、情節 ${csvCards.plot.length}）`));
      if (total === 0) {
        console.error(chalk.red('錯誤：CSV 中沒有可用的卡片資料。'));
        process.exit(1);
      }
      console.log('');
      console.log(chalk.yellow('正在匯出檔案...'));
      const apkgPath = await exportToApkg(csvCards, deckName, options.output);
      const htmlPath = exportToHtml(csvCards, deckName, options.output);
      console.log(chalk.green(`✓ Anki 匯入包：${apkgPath}`));
      console.log(chalk.green(`✓ HTML 預覽：  ${htmlPath}`));
      if (options.flash) {
        const flashPath = exportToFlashHtml(csvCards, deckName, options.output);
        console.log(chalk.green(`✓ 單字卡 HTML：${flashPath}`));
      }
      console.log('');
      console.log(chalk.cyan('· 匯入 Anki：開啟 Anki → 檔案 → 匯入，選取 .apkg 檔案'));
      console.log(chalk.cyan('· 直接預覽：用瀏覽器開啟 .html 檔案'));
      return;
    }

    const supportedExts = ['.pdf', '.epub'];
    if (!supportedExts.includes(ext)) {
      console.error(chalk.red(`錯誤：不支援的檔案格式「${ext}」，目前支援：pdf、epub、csv、目錄`));
      process.exit(1);
    }

    console.log(chalk.yellow(`正在讀取 ${ext.slice(1).toUpperCase()}...`));
    const extractor = ext === '.epub' ? extractEpub : extractPdf;
    let chunks = await extractor(pdfFile);
    if (isFinite(maxChunks)) chunks = chunks.slice(0, maxChunks);
    console.log(chalk.green(`✓ 共切出 ${chunks.length} 個段落區塊`));

    // ── 初學者覆蓋率模式 ─────────────────────────────────────────────
    if (options.beginner) {
      const targetCoverage = parseFloat(options.beginnerTarget ?? '95') / 100;
      const minFreq = parseInt(options.beginnerMinFreq ?? '2', 10);

      process.stdout.write(chalk.yellow('\n正在分析全書詞彙覆蓋率（初學者模式）... 段落 0/' + chunks.length));
      const result = extractBeginnerVocab(chunks, deckName, {
        targetCoverage,
        minFreq,
        includeA1: options.beginnerIncludeA1 ?? false,
        onProgress: (current, total) => {
          process.stdout.write(chalk.yellow(`\r正在分析全書詞彙覆蓋率（初學者模式）... 段落 ${current}/${total}`));
        },
      });
      process.stdout.write(`\r${chalk.green(`✓ 詞彙掃描完成（${chunks.length} 段落）                    `)}\n`);

      console.log(formatCoverageReport(result.report));

      const cutoff = result.report.recommended95Cutoff;
      const tokensPath = exportBeginnerTokensToCsv(result.tokens, deckName, options.output, cutoff);
      console.log(chalk.green(`✓ 完整元資料：${tokensPath}`));
      console.log(chalk.gray(`  共 ${cutoff} 個詞彙（達 ${Math.round(targetCoverage * 100)}% 覆蓋率）`));

      const splitSize = options.beginnerSplit ? parseInt(options.beginnerSplit, 10) : undefined;
      let wordsCsvPaths: string[];
      if (splitSize && splitSize > 0) {
        wordsCsvPaths = exportBeginnerWordsSplit(result.tokens, options.output, deckName, splitSize, cutoff);
        console.log(chalk.green(`✓ 翻譯清單（分割）：${wordsCsvPaths.length} 個檔案`));
        wordsCsvPaths.forEach(p => console.log(chalk.gray(`  - ${p}`)));
      } else {
        const wordsPath = exportBeginnerWordsToCsv(result.tokens, options.output, deckName, cutoff);
        wordsCsvPaths = [wordsPath];
        console.log(chalk.green(`✓ 翻譯清單：  ${wordsPath}`));
      }

      // 匯出人名表（供使用者確認後翻譯時使用）
      const cutoffTokens = cutoff !== undefined ? result.tokens.slice(0, cutoff) : result.tokens;
      const namesFilePath = exportBeginnerNamesFile(cutoffTokens, deckName, options.output);
      console.log(chalk.green(`✓ 人名表：      ${namesFilePath}`));
      console.log(chalk.gray(`  （可在翻譯前確認或修改，翻譯時自動讀取以保護人名）`));

      // MW 預查（可單獨或搭配 --deepl）
      if (options.mw) {
        console.log('');
        const { unfetchedCount } = estimateMWFetch(wordsCsvPaths);
        console.log(chalk.cyan(`MW 預查：共 ${unfetchedCount} 個詞彙待預查`));
        for (const csvPath of wordsCsvPaths) {
          process.stdout.write(chalk.yellow(`正在預查 ${path.basename(csvPath)}...\n`));
          const mwResult = await fetchBeginnerWordsMW(csvPath, (cur, total, meta) => {
            const sourceTag = meta?.source === 'MW' ? chalk.green('[MW]') : meta?.source === 'free' ? chalk.gray('[Free]') : chalk.red('[fallback]');
            process.stdout.write(chalk.yellow(`\r  取得英文定義... ${cur}/${total}  `) + ` ${sourceTag} ${meta?.word ?? ''}   `);
          });
          process.stdout.write(`\r${chalk.green(`  ✓ 完成：預查 ${mwResult.fetchedCount} 個，跳過 ${mwResult.skippedCount} 個`)}\n`);
        }
        console.log('');
        if (!options.deepl && !options.deeplForce) {
          console.log(chalk.cyan('MW 預查完成。definition_en 欄位已寫入 CSV。'));
          console.log(chalk.cyan('下一步：執行以下指令進行 DeepL 翻譯：'));
          if (wordsCsvPaths.length > 1) {
            console.log(chalk.white(`  npx ts-node src/index.ts ${options.output} -d "${deckName}" --deepl`));
          } else {
            console.log(chalk.white(`  npx ts-node src/index.ts ${wordsCsvPaths[0]} -d "${deckName}" --deepl`));
          }
          return;
        }
        // --mw --deepl：繼續執行下方 DeepL 流程
      }

      // DeepL 自動翻譯
      if (options.deepl || options.deeplForce) {
        const deeplCfg = loadDeepLConfig();
        const force = !!options.deeplForce;
        const est = estimateBeginnerTranslate(wordsCsvPaths, { force });
        console.log('');
        if (force) console.log(chalk.magenta('⚡ 強制重新翻譯模式（--deepl-force）'));
        console.log(chalk.cyan(formatBeginnerTranslateEstimate(est)));

        const confirmed = await new Promise<boolean>(resolve => {
          const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
          rl.question(chalk.bold('是否繼續 DeepL 翻譯？[Y/n] '), ans => {
            rl.close();
            resolve(ans.trim().toLowerCase() !== 'n');
          });
        });
        if (!confirmed) {
          console.log(chalk.gray('已取消翻譯，CSV 已儲存可手動填入。'));
          process.exit(0);
        }
        console.log('');

        // 嘗試讀取預建人名表（與 CSV 同目錄的 *-beginner-names.txt）
        const outputDir = path.dirname(wordsCsvPaths[0]);
        const namesFiles = fs.readdirSync(outputDir).filter(f => f.endsWith('-beginner-names.txt'));
        const prebuiltNames = namesFiles.length > 0
          ? loadNamesFile(path.join(outputDir, namesFiles[0]))
          : undefined;
        if (prebuiltNames) {
          console.log(chalk.gray(`  使用預建人名表（${prebuiltNames.size} 個名詞）：${namesFiles[0]}`));
        }

        for (const csvPath of wordsCsvPaths) {
          process.stdout.write(chalk.yellow(`正在翻譯 ${path.basename(csvPath)}...\n`));
          const res = await translateBeginnerWordsCsv(csvPath, deeplCfg, (cur, total, phase, meta) => {
            if (phase === 'dict') {
              const sourceTag = meta?.source === 'dict' ? chalk.magenta('[字典]') : meta?.source === 'MW' ? chalk.green('[MW]') : meta?.source === 'free' ? chalk.gray('[Free]') : meta?.source === 'cached' ? chalk.blue('[快取]') : chalk.red('[fallback]');
              process.stdout.write(chalk.yellow(`\r  取得英文定義... ${cur}/${total}  `) + ` ${sourceTag} ${meta?.word ?? ''}   `);
            } else {
              const label = phase === 'deepl' ? 'DeepL 翻譯' : '寫入';
              process.stdout.write(chalk.yellow(`\r  ${label}... ${cur}/${total}   `));
            }
          }, { force, prebuiltNames });
          process.stdout.write(`\r${chalk.green(`  ✓ 完成：翻譯 ${res.translatedCount} 個，跳過 ${res.skippedCount} 個`)}\n`);
        }

        console.log('');
        console.log(chalk.cyan('翻譯完成，執行以下指令產生字卡：'));
        if (wordsCsvPaths.length > 1) {
          console.log(chalk.white(`  npx ts-node src/index.ts ${options.output} -d "${deckName}" --flash`));
        } else {
          console.log(chalk.white(`  npx ts-node src/index.ts ${wordsCsvPaths[0]} -d "${deckName}" --flash`));
        }
      } else {
        console.log('');
        console.log(chalk.cyan('下一步：'));
        if (wordsCsvPaths.length > 1) {
          console.log(chalk.cyan(`  1. 填入各分割 CSV 的 definition_zh（或加上 --deepl 自動翻譯）`));
          console.log(chalk.cyan(`  2. 翻譯完成後，執行：`));
          console.log(chalk.white(`     npx ts-node src/index.ts ${options.output} -d "${deckName}"`));
          console.log(chalk.gray(`     （指定含所有分割 CSV 的目錄，系統會自動偵測並合併）`));
        } else {
          console.log(chalk.cyan(`  1. 填入 ${path.basename(wordsCsvPaths[0])} 的 definition_zh（或加上 --deepl 自動翻譯）`));
          console.log(chalk.cyan(`  2. 執行：`));
          console.log(chalk.white(`     npx ts-node src/index.ts ${wordsCsvPaths[0]} -d "${deckName}"`));
        }
      }
      return;
    }

    // NLP 前處理管線（逐段落顯示進度）
    const enrichedChunks: EnrichedChunk[] = [];
    let nlpFailed = false;
    for (let i = 0; i < chunks.length; i++) {
      process.stdout.write(chalk.yellow(`\r正在執行 NLP 前處理... 段落 ${i + 1}/${chunks.length}`));
      try {
        enrichedChunks.push({ ...chunks[i], nlp: processChunk(chunks[i]) });
      } catch {
        enrichedChunks.push({ ...chunks[i], nlp: EMPTY_CHUNK_NLP });
        nlpFailed = true;
      }
    }
    const totalSuggestions = enrichedChunks.reduce((s, c) => s + c.nlp.vocabSuggestions.length, 0);
    if (nlpFailed) {
      process.stdout.write(`\r${chalk.yellow(`⚠ NLP 前處理部分失敗，共識別 ${totalSuggestions} 個建議詞彙`)}\n`);
    } else {
      process.stdout.write(`\r${chalk.green(`✓ NLP 前處理完成（${chunks.length} 段落），共識別 ${totalSuggestions} 個建議詞彙`)}\n`);
    }
    console.log('');

    // ── 成本預估（DeepL 才需要確認）────────────────────────────────
    if (options.deepl) {
      const deepEst  = estimateDeepL(enrichedChunks, requestedTypes);
      const claudeEst = isCompare && !options.offline
        ? estimateClaude(enrichedChunks, requestedTypes)
        : undefined;
      const ollamaModel = isCompare && options.offline ? ollamaConfig!.model : undefined;

      console.log(chalk.cyan(formatCostReport(deepEst, claudeEst, ollamaModel)));

      const confirmed = await new Promise<boolean>(resolve => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question(chalk.bold('是否繼續？[Y/n] '), ans => {
          rl.close();
          resolve(ans.trim().toLowerCase() !== 'n');
        });
      });
      if (!confirmed) {
        console.log(chalk.gray('已取消。'));
        process.exit(0);
      }
      console.log('');
    }

    // ── Reading 模式（讀書理解導向） ───────────────────────────────────────────
    if (options.reading) {
      let readingCards;
      if (options.mock) {
        console.log(chalk.yellow('正在分析書籍內容（讀書理解模式）...'));
        readingCards = generateReadingMockCards(enrichedChunks);
      } else if (options.offline) {
        console.log(chalk.yellow(`正在分析書籍內容（讀書理解模式 × Ollama ${ollamaConfig!.model}）...`));
        readingCards = await generateReadingOfflineCards(enrichedChunks, deckName, ollamaConfig!);
      } else {
        console.log(chalk.yellow('正在分析書籍內容（讀書理解模式 × Claude API）...'));
        readingCards = await generateReadingCards(enrichedChunks, deckName);
      }

      const total = readingCards.terms.length + readingCards.causes.length +
        readingCards.chapters.length + readingCards.themes.length;
      console.log('');
      console.log(chalk.cyan('讀書理解字卡統計：'));
      console.log(`  術語卡：     ${readingCards.terms.length} 張`);
      console.log(`  因果事件卡： ${readingCards.causes.length} 張`);
      console.log(`  章節脈絡卡： ${readingCards.chapters.length} 張`);
      console.log(`  主題意象卡： ${readingCards.themes.length} 張`);
      console.log(chalk.bold(`  合計：       ${total} 張`));
      console.log('');
      console.log(chalk.yellow('正在匯出檔案...'));
      const htmlPath = exportReadingToHtml(readingCards, deckName, options.output);
      console.log(chalk.green(`✓ HTML 預覽：  ${htmlPath}`));
      if (options.flash) {
        const flashPath = exportReadingToFlashHtml(readingCards, deckName, options.output);
        console.log(chalk.green(`✓ 單字卡 HTML：${flashPath}`));
      }
      if (options.splitChapters || options.splitSize) {
        const chunkSize = options.splitSize ? parseInt(options.splitSize, 10) : undefined;
        const csvPaths = exportReadingToCsvSplits(readingCards, deckName, options.output, chunkSize);
        console.log(chalk.green(`✓ CSV 分割：   ${csvPaths.length} 個檔案`));
        csvPaths.forEach(p => console.log(chalk.gray(`  - ${p}`)));
        console.log(chalk.gray(`  (填入後可執行: npx ts-node src/index.ts ${options.output} -d "${deckName}")`));
      } else {
        const csvPath = exportReadingToCsv(readingCards, deckName, options.output);
        console.log(chalk.green(`✓ CSV 資料：   ${csvPath}`));
        console.log(chalk.gray(`  (填入後可執行: npx ts-node src/index.ts ${csvPath} -d "${deckName}")`));
      }
      console.log('');
      console.log(chalk.cyan('· 直接預覽：用瀏覽器開啟 .html 檔案'));
      return;
    }

    const allCards: GeneratedCards = { vocab: [], cloze: [], character: [], plot: [] };
    const compareCards: GeneratedCards = { vocab: [], cloze: [], character: [], plot: [] };
    const chunkResults: ChunkResult[] = [];

    for (let i = 0; i < enrichedChunks.length; i++) {
      const chunk = enrichedChunks[i];
      const label = chunk.chapter ? `${chunk.chapter} ` : '';
      process.stdout.write(chalk.yellow(`正在處理區塊 ${i + 1}/${enrichedChunks.length} ${label}...`));

      try {
        // 主要生成路由
        const cards = options.deepl
          ? await generateDeepLCards(chunk, requestedTypes, deeplConfig!)
          : options.mock
            ? generateMockCards(chunk, requestedTypes)
            : options.offline
              ? await generateOfflineCards(chunk, requestedTypes, ollamaConfig!)
              : await generateCards(chunk, requestedTypes);

        allCards.vocab.push(...cards.vocab);
        allCards.cloze.push(...cards.cloze);
        allCards.character.push(...cards.character);
        allCards.plot.push(...cards.plot);
        chunkResults.push({ chunk, cards });

        // 比對模式：同時跑 Claude API 或 Ollama
        if (isCompare) {
          const cmpCards = options.offline
            ? await generateOfflineCards(chunk, requestedTypes, ollamaConfig!)
            : await generateCards(chunk, requestedTypes);
          compareCards.vocab.push(...cmpCards.vocab);
          compareCards.cloze.push(...cmpCards.cloze);
          compareCards.character.push(...cmpCards.character);
          compareCards.plot.push(...cmpCards.plot);
        }

        const counts = [
          cards.vocab.length > 0 && `詞彙 ${cards.vocab.length}`,
          cards.cloze.length > 0 && `克漏字 ${cards.cloze.length}`,
          cards.character.length > 0 && `人物 ${cards.character.length}`,
          cards.plot.length > 0 && `情節 ${cards.plot.length}`,
        ].filter(Boolean).join('、');

        console.log(chalk.green(` ✓ ${counts}`));
      } catch (err) {
        console.log(chalk.red(` ✗ 失敗：${(err as Error).message}`));
      }
    }

    // 全域詞彙卡去重：同字保留最長例句為主，其餘存入 extraExamples 供 ai_hint 使用
    if (requestedTypes.includes('vocab')) {
      const vocabExamples = new Map<string, string[]>();
      for (const { cards } of chunkResults) {
        for (const v of cards.vocab) {
          const list = vocabExamples.get(v.word) ?? [];
          if (!list.includes(v.exampleFromText)) list.push(v.exampleFromText);
          vocabExamples.set(v.word, list);
        }
      }
      const seenVocab = new Set<string>();
      chunkResults.forEach(({ cards }) => {
        cards.vocab = cards.vocab.filter(v => {
          if (seenVocab.has(v.word)) return false;
          seenVocab.add(v.word);
          const all = [...(vocabExamples.get(v.word) ?? [])].sort((a, b) => b.length - a.length);
          v.exampleFromText = all[0];
          if (all.length > 1) v.extraExamples = all.slice(1);
          return true;
        });
      });
      allCards.vocab = chunkResults.flatMap(({ cards }) => cards.vocab);
    }

    // 全域人物卡去重：NLP 後、匯出前，保留全書中 firstMention 分數最高的那張
    if (requestedTypes.includes('character')) {
      const bestChunk = new Map<string, { score: number; idx: number }>();
      chunkResults.forEach(({ cards }, idx) => {
        for (const c of cards.character) {
          const score = scoreMention(c.firstMention);
          const cur = bestChunk.get(c.name);
          if (!cur || score > cur.score) bestChunk.set(c.name, { score, idx });
        }
      });
      chunkResults.forEach(({ cards }, idx) => {
        cards.character = cards.character.filter(c => bestChunk.get(c.name)?.idx === idx);
      });
      allCards.character = chunkResults.flatMap(({ cards }) => cards.character);
    }

    const total = allCards.vocab.length + allCards.cloze.length + allCards.character.length + allCards.plot.length;
    console.log('');
    console.log(chalk.cyan(`產生字卡統計：`));
    console.log(`  詞彙卡：     ${allCards.vocab.length} 張`);
    console.log(`  克漏字：     ${allCards.cloze.length} 張`);
    console.log(`  人物概念卡：  ${allCards.character.length} 張`);
    console.log(`  情節摘要卡：  ${allCards.plot.length} 張`);
    console.log(chalk.bold(`  合計：       ${total} 張`));
    console.log('');

    if (total === 0) {
      console.log(chalk.red('沒有產生任何字卡，請確認 PDF 內容是否正確。'));
      process.exit(1);
    }

    console.log(chalk.yellow('正在匯出檔案...'));
    const apkgPath = await exportToApkg(allCards, deckName, options.output);
    const htmlPath = exportToHtml(allCards, deckName, options.output);
    console.log(chalk.green(`✓ Anki 匯入包：${apkgPath}`));
    console.log(chalk.green(`✓ HTML 預覽：  ${htmlPath}`));

    if (options.mock) {
      if (options.splitChapters || options.splitSize) {
        const splitBy = options.splitChapters ? 'chapter' : 'size';
        const splitSize = options.splitSize ? parseInt(options.splitSize, 10) : 10;
        const csvPaths = exportToCsvSplits(chunkResults, deckName, options.output, splitBy, splitSize);
        console.log(chalk.green(`✓ CSV 分割：   ${csvPaths.length} 個檔案`));
        csvPaths.forEach(p => console.log(chalk.gray(`  - ${p}`)));
        console.log(chalk.gray(`  (填入後可執行: npx ts-node src/index.ts ${options.output} -d "${deckName}")`));
      } else {
        const csvPath = exportToCsv(allCards, deckName, options.output);
        console.log(chalk.green(`✓ CSV 資料：   ${csvPath}`));
        console.log(chalk.gray(`  (可編輯後執行: npx ts-node src/index.ts ${csvPath} -d "${deckName}")`));
      }
    }

    if (options.flash) {
      const flashPath = exportToFlashHtml(allCards, deckName, options.output);
      console.log(chalk.green(`✓ 單字卡 HTML：${flashPath}`));
    }

    if (isCompare) {
      const otherLabel = options.offline ? `Ollama (${ollamaConfig!.model})` : 'Claude API';
      const cmpPath = exportToComparisonHtml(allCards, compareCards, otherLabel, deckName, options.output);
      console.log(chalk.blue(`✓ 比對 HTML：  ${cmpPath}`));
    }
    console.log('');
    console.log(chalk.cyan('· 匯入 Anki：開啟 Anki → 檔案 → 匯入，選取 .apkg 檔案'));
    console.log(chalk.cyan('· 直接預覽：用瀏覽器開啟 .html 檔案'));
  });

program.parse();
