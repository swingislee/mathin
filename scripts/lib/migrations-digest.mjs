import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { normalizeNewlines } from "./text-hash.mjs";

/** 迁移目录的内容摘要。用于判断生成的类型是否落后于 migrations——
 *  文件 mtime 在全新 clone（CI）里不可靠，内容摘要可复现。
 *  换行归一化的理由见 `lib/text-hash.mjs`。 */
export function migrationsDigest(root = process.cwd()) {
  const dir = path.join(root, "supabase", "migrations");
  const hash = crypto.createHash("sha256");
  for (const name of fs.readdirSync(dir).filter((file) => file.endsWith(".sql")).sort()) {
    hash.update(name);
    hash.update(normalizeNewlines(fs.readFileSync(path.join(dir, name), "utf8")));
  }
  return hash.digest("hex");
}

export const DIGEST_PREFIX = "// migrations-digest: ";
