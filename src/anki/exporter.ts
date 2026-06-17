import Database from 'better-sqlite3';
import JSZip from 'jszip';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { GeneratedCards } from '../cards/types';
import { BASIC_FRONT, BASIC_BACK, CLOZE_FRONT, CLOZE_BACK, CARD_CSS } from '../cards/templates';

const MODEL_BASIC_ID = 1715000001;
const MODEL_BASIC_REVERSED_ID = 1715000002;
const MODEL_CLOZE_ID = 1715000003;
const DECK_ID = 1715000100;
const COL_ID = 1;

function now(): number {
  return Math.floor(Date.now() / 1000);
}

let _idCounter = Date.now();
function makeId(): number {
  return ++_idCounter;
}

function buildColJson(deckName: string): string {
  const models = {
    [MODEL_BASIC_ID]: {
      id: MODEL_BASIC_ID, name: 'Basic (PDF Anki)', type: 0, mod: now(), usn: -1,
      sortf: 0, did: DECK_ID, tmpls: [
        { name: 'Card 1', ord: 0, qfmt: BASIC_FRONT, afmt: BASIC_BACK, did: null, bqfmt: '', bafmt: '' },
      ],
      flds: [
        { name: 'Front', ord: 0, sticky: false, rtl: false, font: 'Arial', size: 20 },
        { name: 'Back', ord: 1, sticky: false, rtl: false, font: 'Arial', size: 20 },
      ],
      css: CARD_CSS, latexPre: '', latexPost: '', vers: [], tags: [],
    },
    [MODEL_BASIC_REVERSED_ID]: {
      id: MODEL_BASIC_REVERSED_ID, name: 'Basic (PDF Anki) + Reversed', type: 0, mod: now(), usn: -1,
      sortf: 0, did: DECK_ID, tmpls: [
        { name: 'Card 1', ord: 0, qfmt: BASIC_FRONT, afmt: BASIC_BACK, did: null, bqfmt: '', bafmt: '' },
        { name: 'Card 2', ord: 1, qfmt: '{{Back}}', afmt: '{{FrontSide}}<hr id="answer">{{Front}}', did: null, bqfmt: '', bafmt: '' },
      ],
      flds: [
        { name: 'Front', ord: 0, sticky: false, rtl: false, font: 'Arial', size: 20 },
        { name: 'Back', ord: 1, sticky: false, rtl: false, font: 'Arial', size: 20 },
      ],
      css: CARD_CSS, latexPre: '', latexPost: '', vers: [], tags: [],
    },
    [MODEL_CLOZE_ID]: {
      id: MODEL_CLOZE_ID, name: 'Cloze (PDF Anki)', type: 1, mod: now(), usn: -1,
      sortf: 0, did: DECK_ID, tmpls: [
        { name: 'Cloze', ord: 0, qfmt: CLOZE_FRONT, afmt: CLOZE_BACK, did: null, bqfmt: '', bafmt: '' },
      ],
      flds: [
        { name: 'Text', ord: 0, sticky: false, rtl: false, font: 'Arial', size: 20 },
        { name: 'Hint', ord: 1, sticky: false, rtl: false, font: 'Arial', size: 20 },
      ],
      css: CARD_CSS, latexPre: '', latexPost: '', vers: [], tags: [],
    },
  };

  const decks = {
    [DECK_ID]: {
      id: DECK_ID, name: deckName, desc: '', mod: now(), usn: -1,
      collapsed: false, browserCollapsed: false,
      conf: 1, extendNew: 10, extendRev: 50, newToday: [0, 0], revToday: [0, 0], lrnToday: [0, 0], timeToday: [0, 0],
    },
  };

  const dconf = {
    1: {
      id: 1, name: 'Default', mod: now(), usn: -1,
      maxTaken: 60, timer: 0, autoplay: true, replayq: true,
      new: { delays: [1, 10], ints: [1, 4, 7], initialFactor: 2500, separate: true, order: 1, perDay: 20 },
      lapse: { delays: [10], leechAction: 0, leechFails: 8, minInt: 1, mult: 0 },
      rev: { ease4: 1.3, fuzz: 0.05, ivlFct: 1, maxIvl: 36500, minSpace: 1, perDay: 200 },
    },
  };

  return JSON.stringify({ models, decks, dconf });
}

function initSchema(db: Database.Database, deckName: string): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS col (
      id INTEGER PRIMARY KEY, crt INTEGER, mod INTEGER, scm INTEGER, ver INTEGER,
      dty INTEGER, usn INTEGER, ls INTEGER, conf TEXT, models TEXT, decks TEXT, dconf TEXT, tags TEXT
    );
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY, guid TEXT NOT NULL, mid INTEGER NOT NULL, mod INTEGER NOT NULL,
      usn INTEGER NOT NULL, tags TEXT NOT NULL, flds TEXT NOT NULL, sfld TEXT NOT NULL,
      csum INTEGER NOT NULL, flags INTEGER NOT NULL, data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cards (
      id INTEGER PRIMARY KEY, nid INTEGER NOT NULL, did INTEGER NOT NULL, ord INTEGER NOT NULL,
      mod INTEGER NOT NULL, usn INTEGER NOT NULL, type INTEGER NOT NULL, queue INTEGER NOT NULL,
      due INTEGER NOT NULL, ivl INTEGER NOT NULL, factor INTEGER NOT NULL, reps INTEGER NOT NULL,
      lapses INTEGER NOT NULL, left INTEGER NOT NULL, odue INTEGER NOT NULL, odid INTEGER NOT NULL,
      flags INTEGER NOT NULL, data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS revlog (
      id INTEGER PRIMARY KEY, cid INTEGER NOT NULL, usn INTEGER NOT NULL, ease INTEGER NOT NULL,
      ivl INTEGER NOT NULL, lastIvl INTEGER NOT NULL, factor INTEGER NOT NULL, time INTEGER NOT NULL,
      type INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS graves (usn INTEGER NOT NULL, oid INTEGER NOT NULL, type INTEGER NOT NULL);
  `);

  const colJson = buildColJson(deckName);
  db.prepare(`
    INSERT INTO col (id, crt, mod, scm, ver, dty, usn, ls, conf, models, decks, dconf, tags)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    COL_ID, now(), now(), now(), 11, 0, -1, 0,
    '{}',
    JSON.stringify(JSON.parse(colJson).models),
    JSON.stringify(JSON.parse(colJson).decks),
    JSON.stringify(JSON.parse(colJson).dconf),
    '{}'
  );
}

function insertNote(db: Database.Database, modelId: number, fields: string[]): number {
  const nid = makeId();
  const flds = fields.join('\x1f');
  const sfld = fields[0].replace(/<[^>]+>/g, '').slice(0, 255);
  const csum = sfld.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);

  db.prepare(`
    INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(nid, nid.toString(36), modelId, now(), -1, '', flds, sfld, csum, 0, '');

  return nid;
}

function insertCard(db: Database.Database, nid: number, ord: number, due: number): void {
  db.prepare(`
    INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(makeId(), nid, DECK_ID, ord, now(), -1, 0, 0, due, 0, 0, 0, 0, 0, 0, 0, 0, '');
}

export async function exportToApkg(
  cards: GeneratedCards,
  deckName: string,
  outputDir: string,
  audioDir?: string,
): Promise<string> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'novel2anki-'));
  const dbPath = path.join(tmpDir, 'collection.anki2');
  const db = new Database(dbPath);

  initSchema(db, deckName);

  // Pre-compute which words have a local MP3 (filename = word.toLowerCase().mp3)
  const audioFiles = new Map<string, string>(); // word.mp3 → absolute path
  if (audioDir && fs.existsSync(audioDir)) {
    for (const card of cards.vocab) {
      const filename = `${card.word.toLowerCase()}.mp3`;
      const fullPath = path.join(audioDir, filename);
      if (fs.existsSync(fullPath)) audioFiles.set(filename, fullPath);
    }
  }

  let due = 1;

  for (const card of cards.vocab) {
    const audioTag = audioFiles.has(`${card.word.toLowerCase()}.mp3`)
      ? `[sound:${card.word.toLowerCase()}.mp3]`
      : '';
    const front = `${audioTag}<div class="word">${card.word}</div>${card.definition_en ? `<div class="definition-en">${card.definition_en}</div>` : ''}`;
    const back  = `${card.word_zh ? `<div class="word-zh">${card.word_zh}</div>` : ''}<div class="definition">${card.definition_zh}</div><div class="example">${card.exampleFromText}</div>${card.exampleZh ? `<div class="example">${card.exampleZh}</div>` : ''}`;
    const nid = insertNote(db, MODEL_BASIC_ID, [front, back]);
    insertCard(db, nid, 0, due++);
  }

  for (const card of cards.character) {
    const front = `<div class="character-name">${card.name}</div><div class="example">${card.firstMention}</div>`;
    const back = `<div class="definition">${card.description_zh}</div>`;
    const nid = insertNote(db, MODEL_BASIC_ID, [front, back]);
    insertCard(db, nid, 0, due++);
  }

  for (const card of cards.plot) {
    const front = `<div class="plot-q">${card.question_zh}</div>`;
    const back = `<div class="definition">${card.answer_zh}</div>`;
    const nid = insertNote(db, MODEL_BASIC_REVERSED_ID, [front, back]);
    insertCard(db, nid, 0, due++);
    insertCard(db, nid, 1, due++);
  }

  for (const card of cards.cloze) {
    const nid = insertNote(db, MODEL_CLOZE_ID, [card.text, card.hint_zh]);
    insertCard(db, nid, 0, due++);
  }

  db.close();

  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${deckName}.apkg`);

  // Build media map: {"0": "word1.mp3", "1": "word2.mp3", ...}
  const audioEntries = Array.from(audioFiles.entries()); // [filename, fullPath]
  const mediaMap: Record<string, string> = {};
  audioEntries.forEach(([filename], idx) => { mediaMap[String(idx)] = filename; });

  const zip = new JSZip();
  zip.file('collection.anki2', fs.readFileSync(dbPath));
  zip.file('media', JSON.stringify(mediaMap));
  for (let idx = 0; idx < audioEntries.length; idx++) {
    zip.file(String(idx), fs.readFileSync(audioEntries[idx][1]));
  }
  const content = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
  fs.writeFileSync(outputPath, content);

  fs.rmSync(tmpDir, { recursive: true });
  return outputPath;
}
