import { z } from "zod";
import { miniappAssetPath } from "@/features/school/miniapp-settings/contract";
import {
  runtimeIcons, runtimeRoutes, runtimeSources, runtimeTabSlots,
  type RuntimeAction, type RuntimeBlockSpec, type RuntimeRule, type RuntimeScreenSpec, type RuntimeSpec, type RuntimeTabSpec,
} from "../../../../contracts/participant-api/runtime";

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const text = (limit: number) => z.object({ zh: z.string().max(limit), en: z.string().max(limit) }).strict();
const param = z.string().regex(/^[a-zA-Z0-9_.:-]{0,128}$/);
const params = z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/), param).refine(v => Object.keys(v).length <= 8);
/** Uploaded Mini Program images, or a bundled asset such as `asset:appointment`. */
export const runtimeImage = z.string().refine(v => !v || miniappAssetPath.test(v) || /^asset:[a-z0-9/-]{1,60}$/.test(v));
const icon = z.string().refine(v => (runtimeIcons as readonly string[]).includes(v) || miniappAssetPath.test(v));
const date = z.string().regex(/^(?:\d{4}-\d{2}-\d{2})?$/);

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
  z.object({ type: z.literal("screen"), screen: id, params: params.optional() }).strict(),
  z.object({ type: z.literal("tab"), slot: z.union(runtimeTabSlots.map(slot => z.literal(slot))) }).strict(),
  z.object({ type: z.literal("route"), route: z.enum(runtimeRoutes), query: params.optional() }).strict(),
  z.object({ type: z.literal("phone"), number: z.string().regex(/^\+?[0-9 ()-]{6,30}$/) }).strict(),
  z.object({ type: z.literal("copy"), text: z.string().min(1).max(200) }).strict(),
  z.object({ type: z.literal("login") }).strict(), z.object({ type: z.literal("logout") }).strict(),
  z.object({ type: z.literal("back") }).strict(), z.object({ type: z.literal("refresh") }).strict(),
]);

const link = z.object({ label: text(40), action: runtimeActionSchema }).strict();
const base = { id, visibleWhen: runtimeRuleSchema.optional() };
const entry = z.object({ id, label: text(60), icon, action: runtimeActionSchema, visibleWhen: runtimeRuleSchema.optional() }).strict();

export const runtimeBlockSchema: z.ZodType<RuntimeBlockSpec> = z.lazy(() => z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("section"), title: text(60), style: z.enum(["card", "plain", "row"]), more: link.optional(),
    blocks: z.array(runtimeBlockSchema).max(24) }).strict(),
  z.object({ ...base, type: z.literal("text"), text: text(2000), tone: z.enum(["body", "muted", "notice"]) }).strict(),
  z.object({ ...base, type: z.literal("image"), image: runtimeImage, fit: z.enum(["width", "cover"]), action: runtimeActionSchema.optional() }).strict(),
  z.object({ ...base, type: z.literal("feature"), title: text(60), body: text(200), image: runtimeImage, action: runtimeActionSchema.optional(),
    style: z.enum(["card", "tile"]).optional() }).strict(),
  z.object({ ...base, type: z.literal("entries"), title: text(60), style: z.enum(["grid", "floating"]), items: z.array(entry).min(1).max(20) }).strict(),
  z.object({ ...base, type: z.literal("list"), title: text(60), source: z.enum(runtimeSources), template: z.enum(["card", "row"]),
    limit: z.number().int().min(1).max(30), empty: text(120), more: link.optional(),
    facets: z.array(z.enum(["stage", "topic"])).max(2), actionLabel: text(20) }).strict(),
  z.object({ ...base, type: z.literal("participants"), title: text(60), empty: text(120), style: z.enum(["chips", "picker", "tile"]).optional() }).strict(),
  z.object({ ...base, type: z.literal("calendar"), title: text(60), empty: text(120), more: link.optional(), weekNavigation: z.boolean().optional(),
    signInLabel: text(40).optional() }).strict(),
  z.object({ ...base, type: z.literal("filters"), clearLabel: text(20) }).strict(),
  z.object({ ...base, type: z.literal("account"), trailing: link.optional() }).strict(),
  z.object({ ...base, type: z.literal("content"), pageId: id }).strict(),
  z.object({ ...base, type: z.literal("button"), label: text(40), appearance: z.enum(["primary", "secondary", "link"]), action: runtimeActionSchema }).strict(),
  z.object({ ...base, type: z.literal("divider") }).strict(),
]));

const screen: z.ZodType<RuntimeScreenSpec> = z.object({ id, title: text(40), navigation: z.enum(["brand", "title"]), blocks: z.array(runtimeBlockSchema).max(40) }).strict();
const tab: z.ZodType<RuntimeTabSpec> = z.object({ slot: z.union(runtimeTabSlots.map(slot => z.literal(slot))), screen: id, label: text(8), icon,
  visibleWhen: runtimeRuleSchema.optional() }).strict();

function blockIds(blocks: RuntimeBlockSpec[], seen: Set<string>): boolean {
  for (const block of blocks) {
    if (seen.has(block.id)) return false;
    seen.add(block.id);
    if (block.type === "section" && !blockIds(block.blocks, seen)) return false;
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
  value.screens.forEach((row, index) => { if (!blockIds(row.blocks, new Set())) ctx.addIssue({ code: "custom", path: ["screens", index], message: "DUPLICATE_BLOCK" }); });
});

/** Reading keeps every valid screen and block, so one damaged item never removes the rest of a published app. */
export function tolerantRuntimeSpec(value: unknown): RuntimeSpec | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { version?: unknown; tabs?: unknown; screens?: unknown };
  if (raw.version !== 1 || !Array.isArray(raw.tabs) || !Array.isArray(raw.screens)) return null;
  const blocks = (rows: unknown): RuntimeBlockSpec[] => Array.isArray(rows) ? rows.flatMap(row => {
    if (row && typeof row === "object" && (row as { type?: unknown }).type === "section") {
      const parsed = runtimeBlockSchema.safeParse({ ...row, blocks: [] });
      return parsed.success && parsed.data.type === "section" ? [{ ...parsed.data, blocks: blocks((row as { blocks?: unknown }).blocks) }] : [];
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
