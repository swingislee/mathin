import "server-only";
import { z } from "zod";
import { authorize, PortalError, requireResult } from "@/features/parent-portal/server";
import type { RegistrationRpc } from "@/features/parent-portal/course-server";
import { miniappAssetPath } from "@/features/school/miniapp-settings/contract";
import { miniappPublicClient, readPublishedSettings } from "../settings-server";
import { defaultRuntimeSpec, runtimeStrings } from "./defaults";
import { tolerantRuntimeSpec } from "./spec";
import { readSource, readWeek, shanghaiDate, validDate, type RuntimeIdentity, type SourceInput } from "./sources";
import { sampleItems, sampleParticipants, sampleWeek } from "./samples";
import {
  runtimeBlockVersions, runtimeClientVersion, runtimeIcons, runtimeLocalText, runtimePageFilters, runtimeStringKeys,
  type RuntimeApp, type RuntimeTab, type RuntimeBlockSpec, type RuntimeBlockView, type RuntimeFacetKind, type RuntimeLinkSpec,
  type RuntimeLocale, type RuntimeRule, type RuntimeScreen, type RuntimeScreenSpec, type RuntimeSpec,
} from "../../../../contracts/participant-api/runtime";
import { defaultMiniappSettings, type MiniappSettings } from "../../../../contracts/participant-api/miniapp-settings";

type Published = { revision: string; spec: RuntimeSpec; settings: MiniappSettings };
type Context = { published: Published; identity: RuntimeIdentity; locale: RuntimeLocale; client: number; now: number;
  filters: Record<string, Partial<Record<RuntimeFacetKind, string>>>; anchor: string;
  /** Staff preview: personal sources show example records instead of reading any family data. */
  sample?: boolean };

const uuid = z.string().uuid();
const filtersSchema = z.record(z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), z.object({
  stage: z.string().max(16).optional(), topic: z.string().max(60).optional() }).strict()).refine(v => Object.keys(v).length <= 20);

/** Published runtime screens; before the first runtime publication the current Mini Program settings are presented in runtime form. */
export async function readPublishedRuntime(): Promise<Published> {
  const [settings, raw] = await Promise.all([
    readPublishedSettings(),
    (miniappPublicClient().rpc as unknown as RegistrationRpc)("miniapp_runtime_publication", {}),
  ]);
  const config = settings.config ?? defaultMiniappSettings();
  const value = raw.error ? null : raw.data as { revision?: number; spec?: unknown } | null;
  const spec = value?.spec ? tolerantRuntimeSpec(value.spec) : null;
  if (spec && spec.screens.length && spec.tabs.length >= 2) return { revision: `r${value!.revision}`, spec, settings: config };
  return { revision: `s${settings.revision}`, spec: defaultRuntimeSpec(config), settings: config };
}

function query(request: Request) {
  const params = new URL(request.url).searchParams;
  const locale: RuntimeLocale = params.get("locale") === "en" ? "en" : "zh";
  const client = Math.max(1, Math.min(99, Number.parseInt(request.headers.get("x-mathin-runtime") || "1", 10) || 1));
  let filters: Context["filters"] = {};
  const rawFilters = params.get("filters");
  if (rawFilters) {
    if (rawFilters.length > 2048) throw new PortalError("VALIDATION");
    try { filters = filtersSchema.parse(JSON.parse(rawFilters)); } catch { throw new PortalError("VALIDATION"); }
  }
  const participant = params.get("participant");
  if (participant && !uuid.safeParse(participant).success) throw new PortalError("VALIDATION");
  const anchor = params.get("anchor");
  if (anchor && !validDate(anchor)) throw new PortalError("VALIDATION");
  return { params, locale, client, filters, participant, anchor };
}

/** Visitors browse without a session; a supplied session must be valid and still goes through account and consent checks. */
async function loadIdentity(request: Request, requested: string | null): Promise<RuntimeIdentity> {
  if (!request.headers.get("authorization")) return { signedIn: false, db: null, participants: [], participant: null, stage: null, name: "" };
  const { db, profile } = await authorize(request);
  const [students, summary] = await Promise.all([db.rpc("get_my_students"), db.rpc("get_my_learning_summary")]);
  const grades = (summary.error ? [] : summary.data ?? []) as { student_id: string; grade: number | null }[];
  const participants = ((requireResult(students) ?? []) as { id: string; name: string }[])
    .map(row => ({ id: row.id, name: row.name, stage: grades.find(grade => grade.student_id === row.id)?.grade ?? null }));
  const participant = participants.find(row => row.id === requested)?.id ?? participants[0]?.id ?? null;
  const stage = participants.find(row => row.id === participant)?.stage ?? null;
  return { signedIn: true, db, participants, participant, stage, name: (profile.display_name as string | null) || "" };
}

function allows(rule: RuntimeRule | undefined, context: Context): boolean {
  if (!rule) return true;
  const { identity } = context;
  switch (rule.kind) {
    case "signedIn": return identity.signedIn;
    case "signedOut": return !identity.signedIn;
    case "hasParticipants": return identity.participants.length > 0;
    case "noParticipants": return identity.signedIn && identity.participants.length === 0;
    case "stage": return identity.stage !== null && rule.stages.includes(identity.stage);
    case "between": { const today = shanghaiDate(context.now); return (!rule.from || today >= rule.from) && (!rule.to || today <= rule.to); }
    case "all": return rule.rules.every(row => allows(row, context));
    case "any": return rule.rules.some(row => allows(row, context));
    case "not": return !allows(rule.rule, context);
  }
}

function image(value: string): string {
  if (!value) return "";
  if (miniappAssetPath.test(value)) return "/api/v1/participant/settings/image?path=" + encodeURIComponent(value);
  if (value.startsWith("asset:")) return value;
  return "";
}
/** Tab icons have selected variants for the three original tabs; menu icons use the line icon set. */
function icon(value: string, tab = false, active = false): string {
  if (miniappAssetPath.test(value)) return image(value);
  if (!(runtimeIcons as readonly string[]).includes(value)) return "asset:icons/activity";
  if (value === "discover" || tab && ["calendar", "account"].includes(value)) return `asset:tabs/${value}${active ? "-active" : ""}`;
  return `asset:icons/${value}`;
}
const text = (value: { zh: string; en: string } | undefined, context: Context) => runtimeLocalText(value, context.locale);
const link = (value: RuntimeLinkSpec | undefined, context: Context) => value ? { label: text(value.label, context), action: value.action } : null;
const message = (state: "signedOut" | "error", context: Context) => text(state === "signedOut" ? runtimeStrings.signInPrompt : runtimeStrings.unavailable, context);

async function view(block: RuntimeBlockSpec, context: Context): Promise<RuntimeBlockView | null> {
  if (!allows(block.visibleWhen, context)) return null;
  if (runtimeBlockVersions[block.type] > context.client) return { id: block.id, type: "unsupported", fallback: text(runtimeStrings.updateRequired, context) };
  const sourceInput = (): SourceInput => ({ identity: context.identity, locale: context.locale, settings: context.published.settings,
    filters: { ...context.filters[runtimePageFilters], ...context.filters[block.id] }, now: context.now });
  switch (block.type) {
    case "section": {
      const blocks = (await Promise.all(block.blocks.map(row => view(row, context)))).filter((row): row is RuntimeBlockView => !!row);
      return blocks.length ? { id: block.id, type: "section", title: text(block.title, context), style: block.style, more: link(block.more, context), blocks } : null;
    }
    case "text": { const value = text(block.text, context); return value ? { id: block.id, type: "text", text: value, tone: block.tone } : null; }
    case "image": return image(block.image) ? { id: block.id, type: "image", image: image(block.image), fit: block.fit, action: block.action ?? null } : null;
    case "feature": return { id: block.id, type: "feature", title: text(block.title, context), body: text(block.body, context), image: image(block.image),
      action: block.action ?? null, style: block.style ?? "card" };
    case "entries": {
      const items = block.items.filter(row => allows(row.visibleWhen, context)).map(row => ({ id: row.id, label: text(row.label, context), icon: icon(row.icon), action: row.action }));
      return items.length ? { id: block.id, type: "entries", title: text(block.title, context), style: block.style, items } : null;
    }
    case "list": {
      const base = { id: block.id, type: "list" as const, title: text(block.title, context), template: block.template, empty: text(block.empty, context), more: link(block.more, context) };
      try {
        const result = context.sample && block.source !== "activities.catalog"
          ? { items: sampleItems(block.source, context.locale), facets: [] }
          : await readSource(block.source, sourceInput());
        if (!result) return { ...base, items: [], facets: [], state: "signedOut", message: message("signedOut", context) };
        const items = result.items.slice(0, block.limit).map(row => ({ ...row, actionLabel: row.actionLabel || text(block.actionLabel, context) }));
        return { ...base, items, facets: result.facets.filter(row => block.facets.includes(row.id)), state: "ready", message: "" };
      } catch (error) {
        console.warn("Runtime list source failed", block.source, error instanceof Error ? error.message : error);
        return { ...base, items: [], facets: [], state: "error", message: message("error", context) };
      }
    }
    case "participants": {
      const state = context.identity.signedIn ? "ready" : "signedOut";
      const stages = context.published.settings.stages.flatMap(group => group.stages);
      const stageLabel = (value: number | null | undefined) => { const row = stages.find(stage => stage.stageNumber === value); return row ? text(row.label, context) : ""; };
      return { id: block.id, type: "participants", title: text(block.title, context), style: block.style ?? "chips", selected: context.identity.participant ?? "", empty: text(block.empty, context),
        participants: context.identity.participants.map(row => ({ id: row.id, name: row.name, detail: stageLabel(row.stage) })), state, message: state === "signedOut" ? message("signedOut", context) : "" };
    }
    case "calendar": {
      const anchor = context.anchor || shanghaiDate(context.now);
      const base = { id: block.id, type: "calendar" as const, title: text(block.title, context), empty: text(block.empty, context), more: link(block.more, context),
        navigation: block.weekNavigation === true, signInLabel: text(block.signInLabel, context) || text(runtimeStrings.signIn, context) };
      try {
        const real = await readWeek(sourceInput(), anchor);
        const week = context.sample ? { ...real, ...sampleWeek(real.days, context.locale) } : real;
        const state = context.identity.signedIn ? "ready" : "signedOut";
        return { ...base, ...week, state, message: state === "signedOut" ? message("signedOut", context) : "" };
      } catch (error) {
        console.warn("Runtime calendar source failed", error instanceof Error ? error.message : error);
        return { ...base, anchor, previous: anchor, next: anchor, days: [], items: [], state: "error", message: message("error", context) };
      }
    }
    case "account": return { id: block.id, type: "account", signedIn: context.identity.signedIn,
      name: context.identity.signedIn ? context.identity.name || (context.locale === "zh" ? "我的账号" : "My account") : "",
      prompt: context.locale === "zh" ? "点击登录" : "Sign in", trailing: context.identity.signedIn ? link(block.trailing, context) : null };
    case "filters": return { id: block.id, type: "filters", facets: [], clearLabel: text(block.clearLabel, context), active: false };
    case "content": return { id: block.id, type: "content", pageId: block.pageId };
    case "button": return { id: block.id, type: "button", label: text(block.label, context), appearance: block.appearance, action: block.action };
    case "divider": return { id: block.id, type: "divider" };
  }
}

async function context(request: Request): Promise<Context & { params: URLSearchParams }> {
  const input = query(request);
  const [published, identity] = await Promise.all([readPublishedRuntime(), loadIdentity(request, input.participant)]);
  return { published, identity, locale: input.locale, client: input.client, now: Date.now(), filters: input.filters, anchor: input.anchor || "", params: input.params };
}
const privateHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

function tabsFor(value: Context): RuntimeTab[] {
  return value.published.spec.tabs.filter(row => allows(row.visibleWhen, value) && value.published.spec.screens.some(screen => screen.id === row.screen))
    .sort((a, b) => a.slot - b.slot).map(row => ({ slot: row.slot, label: text(row.label, value), icon: icon(row.icon, true), activeIcon: icon(row.icon, true, true), screen: row.screen }));
}
export async function runtimeAppGet(request: Request) {
  const value = await context(request);
  const tabs = tabsFor(value);
  const result: RuntimeApp = { protocol: 1, revision: value.published.revision, locale: value.locale, signedIn: value.identity.signedIn,
    theme: value.published.settings.brand.theme, brandName: text(value.published.settings.brand.name, value),
    tabs: tabs.length >= 2 ? tabs : [], strings: Object.fromEntries(runtimeStringKeys.map(key => [key, text(runtimeStrings[key], value)])) as RuntimeApp["strings"] };
  return Response.json(result, { headers: privateHeaders });
}

function findScreen(spec: RuntimeSpec, id: string | null): RuntimeScreenSpec {
  const screen = spec.screens.find(row => row.id === id);
  if (!screen) throw new PortalError("NOT_FOUND");
  return screen;
}
/** A page filter bar shows the facets of the screen's filterable lists; those lists then omit their own filter row. */
function placeFilters(blocks: RuntimeBlockView[]): RuntimeBlockView[] {
  const lists: Extract<RuntimeBlockView, { type: "list" }>[] = [];
  const walk = (rows: RuntimeBlockView[]) => rows.forEach(row => { if (row.type === "list") lists.push(row); else if (row.type === "section") walk(row.blocks); });
  walk(blocks);
  const facets = lists.find(row => row.facets.length)?.facets ?? [];
  const hasBar = blocks.some(row => row.type === "filters");
  const place = (rows: RuntimeBlockView[]): RuntimeBlockView[] => rows.flatMap((row): RuntimeBlockView[] => {
    if (row.type === "filters") return facets.length ? [{ ...row, facets, active: facets.some(facet => !!facet.value) }] : [];
    if (row.type === "list" && hasBar) return [{ ...row, facets: [] }];
    if (row.type === "section") return [{ ...row, blocks: place(row.blocks) }];
    return [row];
  });
  return place(blocks);
}
async function screenView(value: Context, id: string | null): Promise<RuntimeScreen> {
  const screen = findScreen(value.published.spec, id);
  const blocks = placeFilters((await Promise.all(screen.blocks.map(row => view(row, value)))).filter((row): row is RuntimeBlockView => !!row));
  return { id: screen.id, revision: value.published.revision, signedIn: value.identity.signedIn, participant: value.identity.participant,
    title: screen.navigation === "brand" ? text(screen.title, value) || text(value.published.settings.brand.name, value) : text(screen.title, value),
    navigation: screen.navigation, blocks };
}
export async function runtimeScreenGet(request: Request) {
  const value = await context(request);
  return Response.json(await screenView(value, value.params.get("id")), { headers: privateHeaders });
}

/** Renders a draft for the staff canvas: visitors see real public data, the signed-in view uses example records only. */
export async function previewRuntimeScreen(spec: RuntimeSpec, screenId: string, mode: "visitor" | "member", locale: RuntimeLocale) {
  const { settings } = await readPublishedRuntime();
  const identity: RuntimeIdentity = mode === "member"
    ? { signedIn: true, db: null, name: locale === "zh" ? "示例家长" : "Example parent", participants: sampleParticipants, participant: sampleParticipants[0].id, stage: 3 }
    : { signedIn: false, db: null, name: "", participants: [], participant: null, stage: null };
  const value: Context = { published: { revision: "draft", spec, settings }, identity, locale, client: runtimeClientVersion, now: Date.now(), filters: {}, anchor: "", sample: mode === "member" };
  return { screen: await screenView(value, screenId), tabs: tabsFor(value) };
}

function findBlock(blocks: RuntimeBlockSpec[], id: string): RuntimeBlockSpec | null {
  for (const block of blocks) {
    if (block.id === id) return block;
    if (block.type === "section") { const found = findBlock(block.blocks, id); if (found) return found; }
  }
  return null;
}
/** Refreshes one block, for example after choosing a filter or another calendar week. */
export async function runtimeBlockGet(request: Request) {
  const value = await context(request);
  const block = findBlock(findScreen(value.published.spec, value.params.get("screen")).blocks, value.params.get("block") || "");
  if (!block) throw new PortalError("NOT_FOUND");
  return Response.json({ revision: value.published.revision, block: await view(block, value) }, { headers: privateHeaders });
}

