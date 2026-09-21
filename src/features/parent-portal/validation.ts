import { z } from "zod";
import type { FormField } from "../../../contracts/parent-api/portal";

const key = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/).refine(value => !["constructor", "prototype"].includes(value));
const copy = z.object({ zh: z.string().trim().min(1).max(2000), en: z.string().trim().min(1).max(4000) }).strict();
export const formFieldSchema = z.object({
  id: key, type: z.enum(["text", "phone", "textarea", "select", "multiselect"]),
  label: copy, required: z.boolean(),
  options: z.array(z.object({ id: key, label: copy }).strict()).min(1).max(30).optional(),
}).strict().superRefine((field, context) => {
  if (["select", "multiselect"].includes(field.type) && !field.options) context.addIssue({ code: "custom", message: "OPTIONS_REQUIRED" });
  if (field.options && new Set(field.options.map(option => option.id)).size !== field.options.length) context.addIssue({ code: "custom", message: "DUPLICATE_OPTION" });
});
export const intakeFormSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{1,64}$/), version: z.number().int().positive(),
  title: copy, description: copy, privacyNotice: copy,
  fields: z.array(formFieldSchema).min(1).max(20),
}).superRefine((form, context) => {
  if (new Set(form.fields.map(field => field.id)).size !== form.fields.length) context.addIssue({ code: "custom", message: "DUPLICATE_FIELD" });
});
export const intakeSchema = z.object({
  form: z.string().regex(/^[a-z0-9-]{1,64}$/), version: z.number().int().positive(),
  requestId: z.string().uuid(), source: z.string().trim().max(120).default(""),
  consent: z.literal(true), answers: z.record(z.string(), z.union([z.string().max(2000), z.array(z.string().max(40)).max(30)])),
}).strict();

/** 字段 ID 与选项 ID 是数据键；展示名修改后仍能读取原提交的配置快照。 */
export function validateAnswers(fields: FormField[], answers: Record<string, string | string[]>) {
  const known = new Set(fields.map(field => field.id));
  if (Object.keys(answers).some(id => !known.has(id))) return false;
  return fields.every(field => {
    const value = answers[field.id];
    if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) return !field.required;
    if (field.type === "multiselect") return Array.isArray(value) && new Set(value).size === value.length
      && value.every(item => field.options?.some(option => option.id === item));
    if (typeof value !== "string" || (field.required && !value.trim())) return false;
    if (field.type === "select") return Boolean(field.options?.some(option => option.id === value));
    if (field.type === "phone") return /^\+?[0-9 ()-]{6,30}$/.test(value);
    return value.length <= (field.type === "textarea" ? 2000 : 200);
  });
}

export const PHOTO_BYTES = 12 * 1024 * 1024;
export const VIDEO_BYTES = 64 * 1024 * 1024;
/** 依据文件签名选择 Storage MIME；客户端扩展名和 Content-Type 只作提示。 */
export function mediaType(bytes: Uint8Array): { mime: string; extension: string; kind: "image" | "video" } | null {
  if (bytes.length < 12) return null;
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: "image/jpeg", extension: "jpg", kind: "image" };
  if (bytes.slice(0, 8).every((byte, i) => byte === [137, 80, 78, 71, 13, 10, 26, 10][i])) return { mime: "image/png", extension: "png", kind: "image" };
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { mime: "image/webp", extension: "webp", kind: "image" };
  if (ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12);
    if (["heic", "heix", "hevc", "hevx", "mif1"].includes(brand)) return { mime: "image/heic", extension: "heic", kind: "image" };
    if (brand === "qt  ") return { mime: "video/quicktime", extension: "mov", kind: "video" };
    if (["isom", "iso2", "mp41", "mp42", "avc1", "M4V "].includes(brand)) return { mime: "video/mp4", extension: "mp4", kind: "video" };
  }
  return null;
}
