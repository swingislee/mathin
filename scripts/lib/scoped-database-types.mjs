import ts from 'typescript';

/** 从数据库实际生成结果合并指定成员，保持无关 schema 类型逐字不变。 */
export function mergeGeneratedDatabaseTypes(current, generated, scopes) {
  const parse = text => ts.createSourceFile('database.types.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const section = (source, name) => {
    const database = source.statements.find(node => ts.isTypeAliasDeclaration(node) && node.name.text === 'Database');
    const publicSchema = database && ts.isTypeLiteralNode(database.type)
      ? database.type.members.find(member => member.name?.text === 'public') : null;
    const member = publicSchema && ts.isTypeLiteralNode(publicSchema.type)
      ? publicSchema.type.members.find(member => member.name?.text === name) : null;
    if (!member || !ts.isTypeLiteralNode(member.type)) throw new Error('GENERATED_DATABASE_SECTION_MISSING');
    return member.type;
  };
  const base = parse(current), incoming = parse(generated), changes = [];
  if (base.parseDiagnostics.length || incoming.parseDiagnostics.length) throw new Error('GENERATED_DATABASE_TYPES_INVALID');
  for (const [key, names] of Object.entries(scopes)) {
    const target = section(base, key), origin = section(incoming, key);
    if (new Set(names).size !== names.length) throw new Error('DUPLICATE_GENERATED_TYPE_SCOPE');
    for (const name of [...names].sort()) {
      const next = origin.members.find(member => member.name?.text === name);
      if (!next) throw new Error('GENERATED_DATABASE_MEMBER_MISSING');
      const existing = target.members.find(member => member.name?.text === name);
      const successor = target.members.find(member => member.name?.text > name);
      changes.push({
        start: existing?.getFullStart() ?? successor?.getFullStart() ?? target.members.end,
        end: existing?.getEnd() ?? successor?.getFullStart() ?? target.members.end,
        text: next.getFullText(incoming), name,
      });
    }
  }
  // 同一插入点逆序应用，使结果仍按名称排列。
  changes.sort((a, b) => b.start - a.start || b.name.localeCompare(a.name));
  let output = current;
  for (const change of changes) output = output.slice(0, change.start) + change.text + output.slice(change.end);
  if (parse(output).parseDiagnostics.length) throw new Error('MERGED_DATABASE_TYPES_INVALID');
  return output;
}
