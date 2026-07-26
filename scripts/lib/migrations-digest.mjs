import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** 迁移目录的内容摘要。用于判断生成的类型是否落后于 migrations——
 *  文件 mtime 在全新 clone（CI）里不可靠，内容摘要可复现。
 *  Git 会按 .gitattributes 将文本提交为 LF，因此摘要也先归一化换行，
 *  避免 Windows 工作区与 CI clone 对同一份 migration 得出不同结果。 */
export function migrationsDigest(root = process.cwd()) {
  const dir = path.join(root, "supabase", "migrations");
  const hash = crypto.createHash("sha256");
  for (const name of fs.readdirSync(dir).filter((file) => file.endsWith(".sql")).sort()) {
    hash.update(name);
    hash.update(fs.readFileSync(path.join(dir, name), "utf8").replace(/\r\n?/g, "\n"));
  }
  return hash.digest("hex");
}

export const DIGEST_PREFIX = "// migrations-digest: ";
