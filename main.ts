// token-radar-01 entry: read the sealed snapshot, score it, write the board, the dashboard data,
// the dashboard and screenshots, and the dossier the judge reads.
//
//   node main.ts --input <snapshot.json|directory> [--output <dir>]
//
// The snapshot defaults to the sealed /input directory; the output defaults to /output, or to
// MAKEFUN_OUTPUT_DIR when set (outside the grader's container). Node 22+, standard library only.
//
// The scoring lives in lib/model.ts; the dossier is built with the vendored make.fun library.
// The dashboard is static (dashboard/index.html + app.css + app.js) and reads data.js, which this
// program writes from the same board the dossier describes.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

// Directory this file lives in: the dashboard and screenshots are copied from here.
const repoDir = fileURLToPath(new URL('.', import.meta.url));

// The gate's own limits (reference/gate.json): the text cap shapes the dossier's bytes,
// the rest refuse entries that break them.
const DOSSIER_TEXT_MAX_BYTES = 65_536;
const DOSSIER_SCREENSHOT_LIMIT = { max: 4, max_bytes: 524_288 };
const DOSSIER_DASHBOARD_LIMIT = { max_files: 400, max_bytes: 4_194_304 };
const SCREENSHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const MIN_SCREENSHOTS = 3;

/** Stop with a message on stderr and the given exit code. */
function fail(message: string, code: number): never {
  process.stderr.write(message);
  process.exit(code);
}

/**
 * The value of a `--name value` or `--name=value` argument, or `fallback` when neither is given.
 * The space form wins when both are present; a bare trailing `--name` with nothing after it is
 * ignored, exactly like the equals form being absent.
 */
function flagValue(name: string, fallback: string): string {
  const args = process.argv;
  const plain = args.indexOf(`--${name}`);
  if (plain >= 0 && plain + 1 < args.length) return args[plain + 1]!;
  const prefix = `--${name}=`;
  const joined = args.find((a) => a.startsWith(prefix));
  return joined === undefined ? fallback : joined.slice(prefix.length);
}

/** Turn the --input option into the snapshot file: a .json file as-is, a directory's snapshot.json. */
function snapshotPath(option: string): string {
  return option.endsWith('.json') ? option : join(option, 'snapshot.json');
}

/**
 * Copy every regular file of one directory into another, skipping dotfiles, and return the
 * copied names in directory order. A missing source directory copies nothing.
 */
function copyDirectory(source: string, target: string): string[] {
  if (!existsSync(source)) return [];
  mkdirSync(target, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(source)) {
    if (name.startsWith('.')) continue;
    const from = join(source, name);
    if (!statSync(from).isFile()) continue;
    copyFileSync(from, join(target, name));
    copied.push(name);
  }
  return copied;
}

// --- main flow ---

const inputFile = snapshotPath(flagValue('input', '/input'));
if (!existsSync(inputFile)) {
  fail(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`, 2);
}
const outDir = flagValue('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  fail(`token radar: the model wrote a board the gate refuses: ${issue}\n`, 1);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outDir, 'data.js'), dataScript(radar));

copyDirectory(join(repoDir, 'dashboard'), join(outDir, 'dashboard'));
const screenshots = copyDirectory(join(repoDir, 'screenshots'), join(outDir, 'screenshots'));
if (screenshots.length < MIN_SCREENSHOTS) {
  fail(
    `token radar: screenshots/ holds ${screenshots.length} image${screenshots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`,
    1,
  );
}
for (const name of screenshots) {
  if (!SCREENSHOT_NAME.test(name)) {
    fail(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`, 1);
  }
}

// The dossier is written last: the scorer rebuilds it from this output directory and compares bytes.
writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, {
    text_max_bytes: DOSSIER_TEXT_MAX_BYTES,
    screenshots: DOSSIER_SCREENSHOT_LIMIT,
    dashboard: DOSSIER_DASHBOARD_LIMIT,
  }),
);

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: wrote ${join(outDir, 'board.json')}, ${join(outDir, 'data.js')}, ${join(outDir, 'dashboard')} (3 files), ${join(outDir, 'screenshots')} (${screenshots.length} images) and ${join(outDir, 'dossier.json')}\n`,
);
