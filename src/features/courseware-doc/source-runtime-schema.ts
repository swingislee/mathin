import { z } from "zod";

/**
 * Portable source-owned renderer contract.
 *
 * The producer owns the page DOM, CSS and behavior inside an immutable H5
 * package. Mathin only resolves content-addressed bindings and hosts the
 * renderer through the narrow postMessage/H5 pointer protocols.
 */
export const SOURCE_RUNTIME_PAGE_DOC_VERSION = "source-runtime-page-v1";
export const SOURCE_RUNTIME_PROTOCOL = "mathin-source-runtime-v1";
export const SOURCE_RUNTIME_NESTED_H5_PARAM = "mathin_source_runtime";
export const SOURCE_RUNTIME_EDITOR_PARAM = "mathin_source_editor";

const finite = z.number().finite();
const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);
const safePackagePath = z.string().min(1).refine(
  (value) => !value.startsWith("/")
    && !value.includes("\\")
    && value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== ".."),
  "unsafe package path",
);
const safeRuntimeRoute = z.string().min(1).refine(
  (value) => value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") && !value.includes(".."),
  "unsafe runtime route",
);

export const sourceRuntimePageDocSchema = z.object({
  docVersion: z.literal(SOURCE_RUNTIME_PAGE_DOC_VERSION),
  source: z.object({
    sourceSystem: z.string().min(1),
    packageKey: z.string().min(1),
    coursewareId: z.string().min(1),
    pageDatabaseId: z.number().int().positive(),
    sourceSnapshotId: z.number().int().positive(),
    sourceContentHash: sha256Hex,
    pageName: z.string(),
    groupName: z.string().nullable(),
  }).strict(),
  viewport: z.object({
    width: finite.positive(),
    height: finite.positive(),
  }).strict(),
  runtime: z.object({
    protocol: z.literal(SOURCE_RUNTIME_PROTOCOL),
    bindingKey: sha256Hex,
    packageHash: sha256Hex,
    entryPath: safePackagePath,
    sourceFingerprint: sha256Hex,
  }).strict(),
  payload: z.object({
    format: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,79}$/),
    data: z.record(z.string(), z.unknown()),
  }).strict(),
  bindings: z.object({
    resources: z.record(z.string().regex(/^\d+$/), sha256Hex),
    routes: z.array(z.object({
      path: safeRuntimeRoute,
      bindingKey: sha256Hex,
    }).strict()),
  }).strict(),
  behavior: z.object({
    advanceOnCanvasClick: z.boolean(),
  }).strict(),
}).strict();

export type SourceRuntimePageDoc = z.infer<typeof sourceRuntimePageDocSchema>;

export function markSourceRuntimeNestedH5Url(url: string): string {
  const fragmentAt = url.indexOf("#");
  const base = fragmentAt < 0 ? url : url.slice(0, fragmentAt);
  const fragment = fragmentAt < 0 ? "" : url.slice(fragmentAt);
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}${SOURCE_RUNTIME_NESTED_H5_PARAM}=${encodeURIComponent(SOURCE_RUNTIME_PROTOCOL)}${fragment}`;
}

export function markSourceRuntimeEditorUrl(url: string): string {
  const parsed = new URL(url, "http://mathin.local");
  parsed.searchParams.set(SOURCE_RUNTIME_EDITOR_PARAM, SOURCE_RUNTIME_PROTOCOL);
  if (/^https?:\/\//i.test(url)) return parsed.toString();
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function collectSourceRuntimeBindingKeys(doc: SourceRuntimePageDoc): Set<string> {
  return new Set([
    doc.runtime.bindingKey,
    ...Object.values(doc.bindings.resources),
    ...doc.bindings.routes.map((route) => route.bindingKey),
  ]);
}

/**
 * Release snapshots retain historical bindings for audit. Rendering resolves
 * only the closure declared by the producer-owned source document so an
 * obsolete H5 manifest cannot block an unrelated page.
 */
export function scopeSourceRuntimeBindings<T extends { bindingKey: string }>(
  doc: SourceRuntimePageDoc,
  bindings: readonly T[],
): T[] {
  const required = collectSourceRuntimeBindingKeys(doc);
  const scoped = bindings.filter((binding) => required.has(binding.bindingKey));
  const available = new Set(scoped.map((binding) => binding.bindingKey));
  const missing = [...required].filter((bindingKey) => !available.has(bindingKey));
  if (missing.length > 0) {
    throw new Error(`SOURCE_RUNTIME_BINDING_MISSING: ${missing.join(",")}`);
  }
  return scoped;
}

export function isSourceRuntimePageDoc(
  doc: { readonly docVersion: string },
): doc is SourceRuntimePageDoc {
  return doc.docVersion === SOURCE_RUNTIME_PAGE_DOC_VERSION;
}
