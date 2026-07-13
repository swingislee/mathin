import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

const root = process.cwd();
const dir = path.join(root, "content", "terms");
const files = fs.readdirSync(dir).filter((name) => name.endsWith(".mdx"));
const seen = new Map();
const slugs = new Set(files.map((name) => name.replace(/\.mdx$/, "")));
const errors = [];

for (const file of files) {
  const { data } = matter(fs.readFileSync(path.join(dir, file), "utf8"));
  const uid = String(data.uid ?? "");
  if (!/^cn-term-[a-z0-9-]+$/.test(uid)) errors.push(`${file}: uid 缺失或格式非法`);
  if (seen.has(uid)) errors.push(`${file}: uid 与 ${seen.get(uid)} 重复`);
  seen.set(uid, file);
  for (const dep of Array.isArray(data.deps) ? data.deps.map(String) : []) {
    if (!slugs.has(dep)) errors.push(`${file}: 前置概念 ${dep} 不存在`);
  }
}

const relations = JSON.parse(fs.readFileSync(path.join(root, "content", "relations.json"), "utf8"));
for (const uid of Object.keys(relations)) {
  if (!seen.has(uid)) errors.push(`relations.json: 未知 uid ${uid}`);
}
const aliases = JSON.parse(fs.readFileSync(path.join(root,"content","slug-aliases.json"),"utf8"));
for(const [oldSlug,currentSlug] of Object.entries(aliases)){
  if(slugs.has(oldSlug))errors.push(`slug-aliases.json: 旧 slug ${oldSlug} 仍是当前文件`);
  if(!slugs.has(String(currentSlug)))errors.push(`slug-aliases.json: 目标 ${currentSlug} 不存在`);
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`content uid audit passed (${files.length} terms, ${Object.keys(relations).length} relation entries)`);
