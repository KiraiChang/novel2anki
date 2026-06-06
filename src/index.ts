import 'dotenv/config';
import * as readline from 'readline';
import { Command } from 'commander';
import chalk from 'chalk';
import * as path from 'path';
import { extractChunks as extractPdf } from './pdf/extractor';
import { extractChunks as extractEpub } from './epub/extractor';
import { generateCards, CardTypes } from './cards/generator';
import { generateMockCards } from './cards/mockGenerator';
import { generateCards as generateOfflineCards, loadOllamaConfig } from './cards/offlineGenerator';
import { generateDeepLCards } from './cards/deeplGenerator';
import { loadDeepLConfig } from './cards/deeplTranslator';
import { exportToApkg } from './anki/exporter';
import { exportToHtml, exportToComparisonHtml } from './html/exporter';
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
  .action(async (pdfFile: string, options: { // pdfFile = general input file (pdf or epub)
    deck?: string;
    types: string;
    chunks?: string;
    output: string;
    mock?: boolean;
    offline?: boolean;
    model?: string;
    deepl?: boolean;
  }) => {
    const needsApiKey = !options.mock && !options.offline && !options.deepl;
    if (needsApiKey && !process.env.ANTHROPIC_API_KEY) {
      console.error(chalk.red('錯誤：請設定環境變數 ANTHROPIC_API_KEY，或加上 --mock / --offline / --deepl 旗標以不使用 Claude API'));
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
    if (options.deepl && !isCompare) console.log(chalk.blue('   [DeepL 翻譯模式]'));
    if (isCompare) console.log(chalk.blue(`   [DeepL 比對模式：DeepL vs ${options.offline ? `Ollama ${ollamaConfig!.model}` : 'Claude API'}]`));
    console.log(chalk.gray(`   牌組：${deckName}`));
    console.log(chalk.gray(`   字卡類型：${requestedTypes.join(', ')}`));
    console.log('');

    const ext = path.extname(pdfFile).toLowerCase();
    const supportedExts = ['.pdf', '.epub'];
    if (!supportedExts.includes(ext)) {
      console.error(chalk.red(`錯誤：不支援的檔案格式「${ext}」，目前支援：pdf、epub`));
      process.exit(1);
    }

    console.log(chalk.yellow(`正在讀取 ${ext.slice(1).toUpperCase()}...`));
    const extractor = ext === '.epub' ? extractEpub : extractPdf;
    let chunks = await extractor(pdfFile);
    if (isFinite(maxChunks)) chunks = chunks.slice(0, maxChunks);
    console.log(chalk.green(`✓ 共切出 ${chunks.length} 個段落區塊`));

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

    const allCards: GeneratedCards = { vocab: [], cloze: [], character: [], plot: [] };
    const compareCards: GeneratedCards = { vocab: [], cloze: [], character: [], plot: [] };

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
