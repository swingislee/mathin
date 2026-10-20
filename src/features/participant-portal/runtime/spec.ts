import { z } from "zod";
import { miniappAssetPath } from "@/features/school/miniapp-settings/contract";
import {
  runtimeChildren, runtimeIcons, runtimeRoutes, runtimeSources, runtimeTabSlots,
  type RuntimeAction, type RuntimeBlockSpec, type RuntimeRule, type RuntimeScreenSpec, type RuntimeSpec, type RuntimeTabSpec,
} from "../../../../contracts/participant-api/runtime";

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const text = (limit: number) => z.object({ zh: z.string().max(limit), en: z.string().max(limit) }).strict();
export const runtimeParamsSchema = z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/)
  .refine(key => !["constructor", "prototype", "__proto__"].includes(key)), z.string().max(200)).refine(v => Object.keys(v).length <= 12);
const params = runtimeParamsSchema;
/** Uploaded Mini Program images, or a bundled asset such as `asset:appointment`. */
export const runtimeImage = z.string().refine(v => !v || miniappAssetPath.test(v) || /^asset:[a-z0-9/-]{1,60}$/.test(v));
/** Uploaded Mini Program media files (audio and video), or an HTTPS address. */
export const runtimeMediaPath = /^[0-9a-f-]{36}\.(?:mp3|m4a|mp4)$/;
const media = z.string().max(500).refine(v => !v || runtimeMediaPath.test(v) || /^https:\/\/[^\s"'<>]+$/.test(v));
const icon = z.string().refine(v => (runtimeIcons as readonly string[]).includes(v) || miniappAssetPath.test(v));
const date = z.string().regex(/^(?:\d{4}-\d{2}-\d{2})?$/);
/** A Mathin path, or an HTTPS address on a business domain configured for the Mini Program. */
const webUrl = z.string().max(500).refine(v => /^\/(?:zh|en)(?:\/[^\s"'<>]*)?$/.test(v) || /^https:\/\/[^\s"'<>]+$/.test(v));
const command = z.string().regex(/^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*){0,3}$/).max(64);
/** Server-defined data sources for display blocks. Unknown names show the block's own content. */
const source = z.string().regex(/^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*){1,3}$/).max(64);

export const runtimeRuleSchema: z.ZodType<RuntimeRule> = z.lazy(() => z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("signedIn") }).strict(), z.object({ kind: z.literal("signedOut") }).strict(),
  z.object({ kind: z.literal("hasParticipants") }).strict(), z.object({ kind: z.literal("noParticipants") }).strict(),
  z.object({ kind: z.literal("stage"), stages: z.array(z.number().int().min(-1).max(12)).min(1).max(14) }).strict(),
  z.object({ kind: z.literal("between"), from: date, to: date }).strict(),
  z.object({ kind: z.literal("all"), rules: z.array(runtimeRuleSchema).min(1).max(8) }).strict(),
  z.object({ kind: z.literal("any"), rules: z.array(runtimeRuleSchema).min(1).max(8) }).strict(),
  z.object({ kind: z.literal("not"), rule: runtimeRuleSchema }).strict(),
]));

export const runtimeActionSchema: z.ZodType<RuntimeAction> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("screen"), screen: id, params: params.optional(), sheet: z.boolean().optional() }).strict(),
  z.object({ type: z.literal("tab"), slot: z.union(runtimeTabSlots.map(slot => z.literal(slot))) }).strict(),
  z.object({ type: z.literal("route"), route: z.enum(runtimeRoutes), query: params.optional() }).strict(),
  z.object({ type: z.literal("web"), url: webUrl, signIn: z.boolean().optional() }).strict(),
  z.object({ type: z.literal("phone"), number: z.string().regex(/^\+?[0-9 ()-]{6,30}$/) }).strict(),
  z.object({ type: z.literal("copy"), text: z.string().min(1).max(200) }).strict(),
  z.object({ type: z.literal("command"), command, params: params.optional(), confirm: text(120).optional() }).strict(),
  z.object({ type: z.literal("toast"), text: text(60) }).strict(),
  z.object({ type: z.literal("preview"), images: z.array(runtimeImage).min(1).max(9) }).strict(),
  z.object({ type: z.literal("save"), image: runtimeImage }).strict(),
  z.object({ type: z.literal("document"), url: z.string().max(500).refine(v => /^\/api\/v1\/[^\s"'<>]+$/.test(v) || /^https:\/\/[^\s"'<>]+$/.test(v) || /^\/(?:zh|en)\/[^\s"'<>]+$/.test(v)) }).strict(),
  z.object({ type: z.literal("location"), latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), name: text(60), address: text(120) }).strict(),
  z.object({ type: z.literal("subscribe"), templates: z.array(z.string().regex(/^[A-Za-z0-9_-]{8,64}$/)).min(1).max(3) }).strict(),
  ...(["scan", "contact", "share", "participant", "clearCache", "update", "login", "logout", "back", "refresh"] as const)
    .map(type => z.object({ type: z.literal(type) }).strict()),
]);

const link = z.object({ label: text(40), action: runtimeActionSchema }).strict();
const base = { id, visibleWhen: runtimeRuleSchema.optional(), hidden: z.boolean().optional() };
const entry = z.object({ id, label: text(60), icon, action: runtimeActionSchema, visibleWhen: runtimeRuleSchema.optional(), hidden: z.boolean().optional() }).strict();
const blocks = (limit: number) => z.array(z.lazy(() => runtimeBlockSchema)).max(limit);

export const runtimeBlockSchema: z.ZodType<RuntimeBlockSpec> = z.lazy(() => z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("section"), title: text(60), style: z.enum(["card", "plain", "row"]), more: link.optional(), blocks: blocks(24) }).strict(),
  z.object({ ...base, type: z.literal("tabs"), style: z.enum(["segmented", "underline"]),
    tabs: z.array(z.object({ id, label: text(12), blocks: blocks(24) }).strict()).min(2).max(5) }).strict(),
  z.object({ ...base, type: z.literal("collapse"), title: text(60), summary: text(120), open: z.boolean(), blocks: blocks(24) }).strict(),
  z.object({ ...base, type: z.literal("text"), text: text(2000), tone: z.enum(["body", "muted", "notice"]) }).strict(),
  z.object({ ...base, type: z.literal("image"), image: runtimeImage, fit: z.enum(["width", "cover"]), action: runtimeActionSchema.optional() }).strict(),
  z.object({ ...base, type: z.literal("feature"), title: text(60), body: text(200), image: runtimeImage, action: runtimeActionSchema.optional(),
    style: z.enum(["card", "tile"]).optional() }).strict(),
  z.object({ ...base, type: z.literal("entries"), title: text(60), style: z.enum(["grid", "floating"]), items: z.array(entry).min(1).max(20) }).strict(),
  z.object({ ...base, type: z.literal("list"), title: text(60), source: z.enum(runtimeSources), template: z.enum(["card", "row", "timeline", "message", "tile", "carousel"]),
    limit: z.number().int().min(1).max(30), empty: text(120), more: link.optional(),
    facets: z.array(z.string().regex(/^[a-z][a-zA-Z0-9]{0,31}$/)).max(4), actionLabel: text(20), params: params.optional() }).strict(),
  z.object({ ...base, type: z.literal("participants"), title: text(60), empty: text(120), style: z.enum(["chips", "picker", "tile"]).optional() }).strict(),
  z.object({ ...base, type: z.literal("calendar"), title: text(60), empty: text(120), more: link.optional(), weekNavigation: z.boolean().optional(),
    signInLabel: text(40).optional() }).strict(),
  z.object({ ...base, type: z.literal("filters"), clearLabel: text(20) }).strict(),
  z.object({ ...base, type: z.literal("account"), trailing: link.optional() }).strict(),
  z.object({ ...base, type: z.literal("content"), pageId: id }).strict(),
  z.object({ ...base, type: z.literal("button"), label: text(40), appearance: z.enum(["primary", "secondary", "link"]), action: runtimeActionSchema }).strict(),
  z.object({ ...base, type: z.literal("divider") }).strict(),
  z.object({ ...base, type: z.literal("video"), title: text(60), src: media, poster: runtimeImage }).strict(),
  z.object({ ...base, type: z.literal("audio"), title: text(60), loop: z.boolean(), source: source.optional(),
    tracks: z.array(z.object({ id, title: text(80), subtitle: text(80), src: media }).strict()).max(60) }).strict(),
  z.object({ ...base, type: z.literal("card"), style: z.enum(["certificate", "credential", "plain"]), title: text(60), subtitle: text(120),
    fields: z.array(z.object({ label: text(20), value: text(80) }).strict()).max(8), image: runtimeImage, stamp: text(12),
    action: runtimeActionSchema.optional(), source: source.optional(), refreshSeconds: z.number().int().min(0).max(3600).optional() }).strict(),
  z.object({ ...base, type: z.literal("metrics"), title: text(60), columns: z.union([z.literal(2), z.literal(3), z.literal(4)]), source: source.optional(),
    items: z.array(z.object({ label: text(20), value: z.string().max(20), unit: text(8), hint: text(40) }).strict()).max(12) }).strict(),
  z.object({ ...base, type: z.literal("chart"), title: text(60), kind: z.enum(["ring", "bar", "radar", "trend"]), labels: z.array(text(12)).max(12),
    series: z.array(z.object({ name: text(20), values: z.array(z.number().finite().min(0).max(1_000_000)).max(12) }).strict()).max(3),
    max: z.number().finite().min(0).max(1_000_000), caption: text(200), source: source.optional() }).strict(),
  z.object({ ...base, type: z.literal("progress"), title: text(60), source: source.optional(),
    items: z.array(z.object({ label: text(30), value: z.number().finite().min(0), max: z.number().finite().positive(), caption: text(40) }).strict()).max(10) }).strict(),
  z.object({ ...base, type: z.literal("badges"), title: text(60), columns: z.union([z.literal(3), z.literal(4), z.literal(5)]), source: source.optional(),
    items: z.array(z.object({ id, label: text(20), image: runtimeImage, earned: z.boolean(), caption: text(60) }).strict()).max(60) }).strict(),
  z.object({ ...base, type: z.literal("table"), title: text(60), columns: z.array(text(20)).min(1).max(6), source: source.optional(),
    rows: z.array(z.array(text(60)).max(6)).max(60) }).strict(),
  z.object({ ...base, type: z.literal("form"), title: text(60), formId: id, submitLabel: text(20), command: command.optional(), after: runtimeActionSchema.optional() }).strict(),
  z.object({ ...base, type: z.literal("bar"), buttons: z.array(z.object({ id, label: text(20), appearance: z.enum(["primary", "secondary"]), action: runtimeActionSchema }).strict()).min(1).max(3) }).strict(),
]));

const screen: z.ZodType<RuntimeScreenSpec> = z.object({ id, title: text(40), navigation: z.enum(["brand", "title"]), blocks: z.array(runtimeBlockSchema).max(40),
  share: z.object({ title: text(40), image: runtimeImage }).strict().optional() }).strict();
const tab: z.ZodType<RuntimeTabSpec> = z.object({ slot: z.union(runtimeTabSlots.map(slot => z.literal(slot))), screen: id, label: text(8), icon,
  visibleWhen: runtimeRuleSchema.optional(), hidden: z.boolean().optional() }).strict();

function blockIds(blocks: RuntimeBlockSpec[], seen: Set<string>): boolean {
  for (const block of blocks) {
    if (seen.has(block.id)) return false;
    seen.add(block.id);
    if (block.type === "tabs") for (const row of block.tabs) { if (seen.has(row.id)) return false; seen.add(row.id); }
    if (!blockIds(runtimeChildren(block), seen)) return false;
  }
  return true;
}

/** Saving requires a complete, internally consistent specification. */
export const runtimeSpecSchema: z.ZodType<RuntimeSpec> = z.object({
  version: z.literal(1), tabs: z.array(tab).min(2).max(5), screens: z.array(screen).min(1).max(60),
}).strict().superRefine((value, ctx) => {
  const screens = new Set(value.screens.map(row => row.id));
  if (screens.size !== value.screens.length) ctx.addIssue({ code: "custom", path: ["screens"], message: "DUPLICATE_SCREEN" });
  if (new Set(value.tabs.map(row => row.slot)).size !== value.tabs.length) ctx.addIssue({ code: "custom", path: ["tabs"], message: "DUPLICATE_SLOT" });
  value.tabs.forEach((row, index) => { if (!screens.has(row.screen)) ctx.addIssue({ code: "custom", path: ["tabs", index, "screen"], message: "MISSING_SCREEN" }); });
  // Slot 1 is the page WeChat opens first, and a tab bar needs two shown tabs.
  value.tabs.forEach((row, index) => { if (row.hidden && row.slot === 1) ctx.addIssue({ code: "custom", path: ["tabs", index, "hidden"], message: "FIRST_TAB_HIDDEN" }); });
  if (value.tabs.filter(row => !row.hidden).length < 2) ctx.addIssue({ code: "custom", path: ["tabs"], message: "TOO_FEW_TABS" });
  value.screens.forEach((row, index) => { if (!blockIds(row.blocks, new Set())) ctx.addIssue({ code: "custom", path: ["screens", index], message: "DUPLICATE_BLOCK" }); });
});

/** Reading keeps every valid screen and block, so one damaged item never removes the rest of a published app. */
export function tolerantRuntimeSpec(value: unknown): RuntimeSpec | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { version?: unknown; tabs?: unknown; screens?: unknown };
  if (raw.version !== 1 || !Array.isArray(raw.tabs) || !Array.isArray(raw.screens)) return null;
  const blocks = (rows: unknown): RuntimeBlockSpec[] => Array.isArray(rows) ? rows.flatMap((row): RuntimeBlockSpec[] => {
    const type = row && typeof row === "object" ? (row as { type?: unknown }).type : undefined;
    // Containers keep their valid children even when one of them is damaged.
    if (type === "section" || type === "collapse") {
      const parsed = runtimeBlockSchema.safeParse({ ...row, blocks: [] });
      return parsed.success && (parsed.data.type === "section" || parsed.data.type === "collapse") ? [{ ...parsed.data, blocks: blocks((row as { blocks?: unknown }).blocks) }] : [];
    }
    if (type === "tabs") {
      const tabs = (row as { tabs?: unknown }).tabs;
      const parsed = runtimeBlockSchema.safeParse({ ...row, tabs: Array.isArray(tabs) ? tabs.map(tab => ({ ...(tab as object), blocks: [] })) : tabs });
      return parsed.success && parsed.data.type === "tabs" && Array.isArray(tabs)
        ? [{ ...parsed.data, tabs: parsed.data.tabs.map((tab, index) => ({ ...tab, blocks: blocks((tabs[index] as { blocks?: unknown }).blocks) })) }] : [];
    }
    const parsed = runtimeBlockSchema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  }) : [];
  const screens = raw.screens.flatMap(row => {
    const parsed = screen.safeParse({ ...(row as object), blocks: [] });
    return parsed.success ? [{ ...parsed.data, blocks: blocks((row as { blocks?: unknown }).blocks) }] : [];
  });
  const tabs = raw.tabs.flatMap(row => { const parsed = tab.safeParse(row); return parsed.success ? [parsed.data] : []; });
  return { version: 1, tabs, screens };
}
