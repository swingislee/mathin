import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { extractFeishuBase } from './lib/history-archive-source.mjs';
import { reconcileSources } from './lib/source-reconciliation.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';

const { values } = parseArgs({ options: {
  source: { type: 'string', default: 'docs/test_material' }, run: { type: 'string' }, python: { type: 'string' },
  reuse: { type: 'boolean', default: false }, decisions: { type: 'string' }, 'previous-base': { type: 'string' },
} });
if (!values.run) throw new Error('RUN_PATH_REQUIRED');
const workspace = process.cwd();
const source = path.resolve(values.source);
const root = path.resolve(values.run);
const privateRoot = path.resolve('.tmp/source-refresh');
if (!root.startsWith(`${privateRoot}${path.sep}`)) throw new Error('RUN_MUST_USE_PRIVATE_SOURCE_REFRESH_DIRECTORY');
const snapshot = path.join(root, 'sources');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const json = async filename => JSON.parse(await fs.readFile(filename, 'utf8'));
async function filesIn(directory) {
  const found = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error('SOURCE_SYMLINK_UNSUPPORTED');
    if (entry.isDirectory()) found.push(...await filesIn(full));
    else if (/\.(?:base|xlsx)$/u.test(entry.name)) found.push(full);
  }
  return found.sort();
}
let manifest;
if (values.reuse) {
  manifest = (await json(path.join(root, 'manifest.json'))).sourceFiles;
} else {
  await fs.mkdir(root, { recursive: true });
  if ((await fs.readdir(root)).length) throw new Error('RUN_DIRECTORY_MUST_BE_EMPTY');
  manifest = [];
  for (const file of await filesIn(source)) {
    const relative = path.relative(source, file).replaceAll('\\', '/');
    const bytes = await fs.readFile(file);
    const target = path.join(snapshot, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes, { flag: 'wx' });
    manifest.push({ path: relative, bytes: bytes.length, sha256: sha256(bytes) });
  }
  await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify({ at: new Date().toISOString(), sourceFiles: manifest }, null, 2), { flag: 'wx' });
}
const actual = await filesIn(source);
if (actual.length !== manifest.length) throw new Error('SOURCE_SET_CHANGED_CREATE_NEW_RUN');
const expectedPaths = new Set(manifest.map(file => file.path));
if (actual.some(file => !expectedPaths.has(path.relative(source, file).replaceAll('\\', '/')))) throw new Error('SOURCE_SET_CHANGED_CREATE_NEW_RUN');
for (const file of manifest) {
  const target = path.resolve(snapshot, file.path);
  if (!target.startsWith(`${snapshot}${path.sep}`)) throw new Error('SOURCE_MANIFEST_PATH_INVALID');
  for (const filename of [target, path.join(source, file.path)]) {
    const bytes = await fs.readFile(filename);
    if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256) throw new Error('SOURCE_HASH_CHANGED_CREATE_NEW_RUN');
  }
}
const baseFiles = manifest.filter(file => file.path.endsWith('.base'));
if (baseFiles.length !== 1 || !baseFiles[0].path.endsWith('2026-09-07【思维】用户与产品运营表.base')) throw new Error('BUSINESS_AUTHORITY_SOURCE_MISMATCH');
const base = await extractFeishuBase(path.join(snapshot, baseFiles[0].path));
const excelPath = path.join(root, 'excel-extraction.json');
if (!values.reuse) {
  if (!values.python) throw new Error('BUNDLED_PYTHON_PATH_REQUIRED');
  const run = spawnSync(values.python, ['scripts/history-archive-excel.py', '--source', snapshot, '--output', excelPath], { encoding: 'utf8', maxBuffer: 1024 * 1024, windowsHide: true });
  if (run.error || run.status !== 0) throw new Error(`EXCEL_EXTRACTION_FAILED:${run.error?.message || run.stderr}`);
  await fs.writeFile(path.join(root, 'base-extraction.json'), JSON.stringify(base), { flag: 'wx' });
}
const decisions = values.decisions ? await json(path.resolve(values.decisions)) : { confirmedStaffAliases: [] };
const previousBase = values['previous-base'] ? await extractFeishuBase(path.resolve(values['previous-base'])) : null;
const output = reconcileSources({ base, workbooks: await json(excelPath), manifest, confirmedStaffAliases: decisions.confirmedStaffAliases, previousBase });
output.implementationHashes = Object.fromEntries(['scripts/source-reconciliation.mjs', 'scripts/lib/source-reconciliation.mjs', 'scripts/history-archive-excel.py',
  'scripts/lib/history-archive-source.mjs'].map(file => [file, textFileSha256(path.join(workspace, file))]));
output.decisionsSha256 = values.decisions ? textFileSha256(path.resolve(values.decisions)) : null;
const analysisDir = path.join(root, `analysis-${new Date().toISOString().replace(/[-:.]/gu, '')}`);
await fs.mkdir(analysisDir);
const outputPath = path.join(analysisDir, 'reconciliation.json');
await fs.writeFile(outputPath, JSON.stringify(output, null, 2), { flag: 'wx' });
await fs.writeFile(path.join(root, 'latest-analysis.json'), JSON.stringify({ file: path.relative(root, outputPath).replaceAll('\\', '/'), sha256: sha256(await fs.readFile(outputPath)) }));
console.log(JSON.stringify({ output: outputPath, totals: output.totals }));
