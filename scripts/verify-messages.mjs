import fs from "node:fs";
import path from "node:path";

const dir = path.join(process.cwd(), "messages");
const locales = ["zh", "en"];

const flatten = (value, prefix = "") =>
  Object.entries(value).flatMap(([key, child]) =>
    child && typeof child === "object" && !Array.isArray(child)
      ? flatten(child, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );

const keys = Object.fromEntries(
  locales.map((locale) => [
    locale,
    new Set(flatten(JSON.parse(fs.readFileSync(path.join(dir, `${locale}.json`), "utf8")))),
  ]),
);

const errors = [];
for (const locale of locales) {
  for (const other of locales.filter((l) => l !== locale)) {
    for (const key of keys[locale]) {
      if (!keys[other].has(key)) errors.push(`${locale}.json 独有键 ${key}（${other}.json 缺失）`);
    }
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`messages key parity passed (${keys.zh.size} keys × ${locales.length} locales)`);
