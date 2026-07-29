import crypto from "node:crypto";
import fs from "node:fs";

/** 文本内容的换行归一化。
 *  `.gitattributes` 用 `* text=auto eol=lf` 把文本按 LF 入库，Windows 工作区 checkout
 *  出来的却可能是 CRLF。任何"对文件取 hash 再写进仓库"的合同都必须先归一化，
 *  否则同一份内容在开发机与 CI clone 上摘要不同，门禁会在推送后才炸。 */
export function normalizeNewlines(text) {
  return text.replace(/\r\n?/g, "\n");
}

/** 文本文件的可复现 SHA-256：只依赖内容，不依赖 checkout 平台的行尾。 */
export function textFileSha256(filePath) {
  return crypto.createHash("sha256").update(normalizeNewlines(fs.readFileSync(filePath, "utf8"))).digest("hex");
}
