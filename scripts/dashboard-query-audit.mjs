import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

// 只扫描源码：包含布局、动态导入、Server Action 及相关 API；可达调用点不是首屏请求数。
const repo = process.cwd();
const output = path.resolve(process.argv[2] ?? '.tmp/dashboard-query-audit.json');
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
const relative = file => path.relative(repo, file).split(path.sep).join('/');
const unwrap = node => node && (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)
  || ts.isParenthesizedExpression(node) || ts.isSatisfiesExpression(node)) ? unwrap(node.expression) : node;
const value = node => {
  const inner = unwrap(node);
  return inner && ts.isStringLiteralLike(inner) ? inner.text : inner?.getText() ?? '';
};
const schemaNames = { table: new Set(), rpc: new Set() };
for (const file of walk(path.join(repo, 'supabase/migrations')).filter(file => file.endsWith('.sql'))) {
  const sql = fs.readFileSync(file, 'utf8');
  for (const match of sql.matchAll(/create\s+(?:or\s+replace\s+)?(function|table|view)\s+(?:if\s+not\s+exists\s+)?(?:public|mathin_internal)\.([a-z_0-9]+)/gi)) {
    schemaNames[match[1].toLowerCase() === 'function' ? 'rpc' : 'table'].add(match[2]);
  }
}

function resolveImport(specifier, from) {
  const base = specifier.startsWith('@/') ? path.join(repo, 'src', specifier.slice(2))
    : specifier.startsWith('.') ? path.resolve(path.dirname(from), specifier) : null;
  if (!base) return null;
  return ['', '.ts', '.tsx', '.mjs', '.js', '/index.ts', '/index.tsx', '/index.mjs', '/index.js']
    .map(extension => base + extension).find(file => fs.existsSync(file) && fs.statSync(file).isFile()) ?? null;
}

const files = walk(path.join(repo, 'src')).filter(file => /\.[cm]?[jt]sx?$/.test(file) && !file.endsWith('.d.ts'));
const modules = new Map();
const queries = [];
for (const file of files) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const imports = new Set();
  const addImport = specifier => { const target = resolveImport(specifier, file); if (target) imports.add(target); };
  const visit = node => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier
      && ts.isStringLiteralLike(node.moduleSpecifier) && !node.isTypeOnly && !node.importClause?.isTypeOnly) {
      addImport(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteralLike(node.arguments[0] ?? source)) {
        addImport(node.arguments[0].text);
      }
      const expression = unwrap(node.expression);
      const direct = ts.isPropertyAccessExpression(expression) && ['from', 'rpc'].includes(expression.name.text);
      const helperRead = ts.isIdentifier(expression) && expression.text === 'readRelatedAssessmentRows';
      const fromFactory = ts.isCallExpression(expression) && ts.isIdentifier(expression.expression)
        && ['from', 'assessmentReadFrom'].includes(expression.expression.text);
      const namedFrom = ts.isIdentifier(expression) && ['from', 'effective'].includes(expression.text);
      const factorySetup = namedFrom && ts.isCallExpression(node.parent) && node.parent.expression === node;
      const argumentIndex = direct || fromFactory ? 0 : helperRead ? 1 : namedFrom ? (node.arguments.length > 1 ? 1 : 0) : node.arguments.findIndex(argument => {
        const name = value(argument);
        return schemaNames.rpc.has(name) && /rpc|^call$/i.test(node.expression.getText())
          || schemaNames.table.has(name) && /from/i.test(node.expression.getText());
      });
      const nonDatabaseFrom = ts.isPropertyAccessExpression(expression)
        && ['Array', 'Buffer', 'Uint8Array', 'Object'].includes(expression.expression.getText());
      if (argumentIndex >= 0 && !nonDatabaseFrom && !factorySetup) {
        const resource = value(node.arguments[argumentIndex]);
        const kind = direct ? expression.name.text === 'rpc' ? 'rpc' : 'table'
          : schemaNames.rpc.has(resource) ? 'rpc' : 'table';
        let outer = node;
        while (outer.parent && ts.isPropertyAccessExpression(outer.parent) && outer.parent.expression === outer
          && ts.isCallExpression(outer.parent.parent)) outer = outer.parent.parent;
        const text = outer.getText();
        const methods = [...text.matchAll(/\.([a-zA-Z]+)(?:<[^;]*?>)?\s*\(/g)].map(match => match[1]);
        const write = methods.find(method => ['insert', 'update', 'upsert', 'delete', 'upload', 'remove', 'move', 'copy'].includes(method));
        const location = source.getLineAndCharacterOfPosition(node.getStart());
        queries.push({ file: relative(file), line: location.line + 1,
          kind: text.includes('.storage.') ? 'storage' : kind, resource,
          dynamic: !ts.isStringLiteralLike(unwrap(node.arguments[argumentIndex]) ?? source),
          operation: write ?? (kind === 'rpc' ? 'rpc-requires-definition-review' : helperRead || methods.includes('select') ? 'read' : 'builder'),
          methods, directlyBounded: methods.some(method => ['range', 'limit', 'single', 'maybeSingle'].includes(method)),
          countOnly: /head\s*:\s*true/.test(text), routes: [] });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  modules.set(file, imports);
}

const common = files.filter(file => ['src/app/[locale]/layout.tsx', 'src/app/layout.tsx', 'src/proxy.ts'].includes(relative(file)));
const entries = files.filter(file => /(?:page|layout|route)\.tsx?$/.test(file)
  && (relative(file).startsWith('src/app/[locale]/dashboard/') || relative(file).startsWith('src/app/api/')));
const routes = entries.map(entry => {
  const pending = [entry, ...common];
  const reached = new Set();
  for (let dir = path.dirname(entry); dir.startsWith(path.join(repo, 'src/app')); dir = path.dirname(dir)) {
    for (const name of ['layout.tsx', 'layout.ts']) if (fs.existsSync(path.join(dir, name))) pending.push(path.join(dir, name));
  }
  while (pending.length) {
    const file = pending.pop();
    if (reached.has(file)) continue;
    reached.add(file);
    pending.push(...(modules.get(file) ?? []));
  }
  const names = new Set([...reached].map(relative));
  const selected = queries.filter(query => names.has(query.file));
  for (const query of selected) query.routes.push(relative(entry));
  return { entry: relative(entry), kind: relative(entry).startsWith('src/app/api/') ? 'api-superset' : 'dashboard',
    querySites: selected.length, tableReads: selected.filter(query => query.operation === 'read').length,
    rpcSites: selected.filter(query => query.kind === 'rpc').length };
});
const scoped = queries.filter(query => query.routes.length);
const result = { note: '保守静态可达性；含按需操作和写命令。动态参数、RPC 函数体、分页助手及 API 实际调用关系需复核。调用点数量不代表首屏请求数。', routes, queries: scoped };
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ dashboardEntries: routes.filter(route => route.kind === 'dashboard').length,
  apiEntries: routes.filter(route => route.kind !== 'dashboard').length,
  querySites: scoped.length, tableReads: scoped.filter(query => query.operation === 'read').length,
  rpcSites: scoped.filter(query => query.kind === 'rpc').length, output: path.relative(repo, output) }));
