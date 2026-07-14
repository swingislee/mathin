import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

const root = process.cwd();
const dir = path.join(root, "content", "terms");
const files = fs.readdirSync(dir).filter((name) => name.endsWith(".mdx"));
const seen = new Map();
const slugs = new Set(files.map((name) => name.replace(/\.mdx$/, "")));
const errors = [];

/** 汉语拼音音节（可选声母 + 韵母）。用于把拼音标识符永久挡在门外（docs/plan/15-§3.2）。 */
const PINYIN_SYLLABLE =
  /^(?:zh|ch|sh|[bpmfdtnlgkhjqxrzcsyw])?(?:a|o|e|ai|ei|ao|ou|an|en|ang|eng|ong|er|i|ia|ie|iao|iu|ian|in|iang|ing|iong|u|ua|uo|uai|ui|uan|un|uang|ueng|v|ve)$/;

/** 整体判定：**每一段**都是合法拼音音节才算拼音标识符。
 *  逐段判定会误伤——`pi`、`a` 本身也是合法拼音音节，但 `circumference-and-pi`
 *  里的 `circumference` 不是，而 `bai-fen-shu` 三段全是。 */
function isPinyinLike(slug) {
  const parts = slug.split("-");
  return parts.length > 0 && parts.every((part) => PINYIN_SYLLABLE.test(part));
}

/** 受控术语表：新概念必须先在 glossary.json 登记英文数学名词，才能建 MDX。 */
const glossary = JSON.parse(fs.readFileSync(path.join(root, "content", "glossary.json"), "utf8"));
const glossaryBySlug = new Map(glossary.map((entry) => [entry.slug, entry]));
for (const entry of glossary) {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(entry.slug)) errors.push(`glossary.json: ${entry.slug} 不是小写 ASCII 连字符命名`);
  if (isPinyinLike(entry.slug)) errors.push(`glossary.json: ${entry.slug} 是拼音标识符（必须用英文数学名词）`);
  if (entry.uid !== `cn-term-${entry.slug}`) errors.push(`glossary.json: ${entry.slug} 的 uid 与 slug 不一致`);
  if (!entry.zh || !entry.en) errors.push(`glossary.json: ${entry.slug} 缺中文名或英文名`);
  if (!slugs.has(entry.slug)) errors.push(`glossary.json: ${entry.slug} 没有对应的 MDX 文件`);
}

for (const file of files) {
  const slug = file.replace(/\.mdx$/, "");
  const { data } = matter(fs.readFileSync(path.join(dir, file), "utf8"));
  const uid = String(data.uid ?? "");
  if (!/^cn-term-[a-z0-9-]+$/.test(uid)) errors.push(`${file}: uid 缺失或格式非法`);
  if (isPinyinLike(slug)) errors.push(`${file}: slug 是拼音标识符（必须用英文数学名词）`);
  if (uid !== `cn-term-${slug}`) errors.push(`${file}: uid 必须为 cn-term-<slug>，实为 ${uid}`);
  if (!glossaryBySlug.has(slug)) errors.push(`${file}: ${slug} 未登记在 content/glossary.json（受控术语表）`);
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
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(
  `content uid audit passed (${files.length} terms, ${glossary.length} glossary entries, ${Object.keys(relations).length} relation entries)`,
);
