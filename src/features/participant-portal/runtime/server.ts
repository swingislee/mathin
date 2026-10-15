import "server-only";
import { z } from "zod";
import { authorize, PortalError, requireResult } from "@/features/parent-portal/server";
import type { RegistrationRpc } from "@/features/parent-portal/course-server";
import { miniappAssetPath } from "@/features/school/miniapp-settings/contract";
import { miniappPublicClient, readPublishedSettings } from "../settings-server";
import { defaultRuntimeSpec, runtimeStrings } from "./defaults";
import { runtimeMediaPath, tolerantRuntimeSpec } from "./spec";
import { readSource, readWeek, shanghaiDate, validDate, type RuntimeIdentity, type SourceInput } from "./sources";
import { readDisplay, type DisplayData } from "./display";
import { chartImage, chartColors, segment } from "./chart";
import { runtimeFormGroups } from "./forms";
import { sampleDisplay, sampleItems, sampleParticipants, sampleWeek } from "./samples";
import {
  runtimeBlockVersions, runtimeChildren, runtimeClientVersion, runtimeIcons, runtimeLocalText, runtimePageFilters, runtimeStringKeys,
  type RuntimeAction, type RuntimeApp, type RuntimeTab, type RuntimeBlockSpec, type RuntimeBlockView, type RuntimeLinkSpec,
  type RuntimeLocale, type RuntimeRule, type RuntimeScreen, type RuntimeScreenSpec, type RuntimeSpec,
} from "../../../../contracts/participant-api/runtime";
import { defaultMiniappSettings, type MiniappSettings } from "../../../../contracts/participant-api/miniapp-settings";
import type { ExperienceForm } from "../../../../contracts/participant-api/miniapp-experience";
import { experienceFormSchema } from "@/features/school/miniapp-settings/experience-schema";
import { defaultMiniappExperience } from "../../../../contracts/participant-api/miniapp-experience-templates";

export type Published = { revision: string; spec: RuntimeSpec; settings: MiniappSettings; settingsRevision: number };
export type Context = { published: Published; identity: RuntimeIdentity; locale: RuntimeLocale; client: number; now: number;
  filters: Record<string, Record<string, string>>; anchor: string; cursor: string;
  /** Staff preview: personal sources show example records instead of reading any family data. */
  sample?: boolean;
  /** Staff preview of a draft: forms come from the draft settings. */
  draft?: boolean };

/** A published form with its questions, read as the requesting account so its audience rule applies. Missing or not allowed reads as `null`. */
export async function readForm(formId: string, identity: RuntimeIdentity): Promise<{ form: ExperienceForm | null; revision: number }> {
  const db = identity.db ?? miniappPublicClient();
  const result = await (db.rpc as unknown as RegistrationRpc)("miniapp_experience_document", { p_kind: "form", p_id: formId });
  if (result.error) return { form: null, revision: 0 };
  const value = result.data as { revision: number; document: unknown };
  const parsed = experienceFormSchema.safeParse(value.document);
  return { form: parsed.success ? parsed.data : null, revision: value.revision };
}

const uuid = z.string().uuid();
const filtersSchema = z.record(z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,31}$/), z.string().max(60))
  .refine(v => Object.keys(v).length <= 6)).refine(v => Object.keys(v).length <= 20);

/** Published runtime screens; before the first runtime publication the current Mini Program settings are presented in runtime form. */
export async function readPublishedRuntime(): Promise<Published> {
  const [settings, raw] = await Promise.all([
    readPublishedSettings(),
    (miniappPublicClient().rpc as unknown as RegistrationRpc)("miniapp_runtime_publication", {}),
  ]);
  const config = settings.config ?? defaultMiniappSettings();
  const value = raw.error ? null : raw.data as { revision?: number; spec?: unknown } | null;
  const spec = value?.spec ? tolerantRuntimeSpec(value.spec) : null;
  if (spec && spec.screens.length && spec.tabs.filter(row => !row.hidden).length >= 2) return { revision: `r${value!.revision}`, spec, settings: config, settingsRevision: settings.revision };
  return { revision: `s${settings.revision}`, spec: defaultRuntimeSpec(config), settings: config, settingsRevision: settings.revision };
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
  const cursor = params.get("cursor") || "";
  if (cursor.length > 64) throw new PortalError("VALIDATION");
  return { params, locale, client, filters, participant, anchor, cursor };
}

/** Visitors browse without a session; a supplied session must be valid and still goes through account and consent checks. */
export async function loadIdentity(request: Request, requested: string | null): Promise<RuntimeIdentity> {
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

/** Hidden objects are never sent; the rest are sent when their rule matches the requesting account. */
function shown(row: { visibleWhen?: RuntimeRule; hidden?: boolean }, context: Context) { return !row.hidden && allows(row.visibleWhen, context); }

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

export function image(value: string): string {
  if (!value) return "";
  if (miniappAssetPath.test(value)) return "/api/v1/participant/settings/image?path=" + encodeURIComponent(value);
  if (value.startsWith("asset:") || value.startsWith("/api/") || value.startsWith("https://") || value.startsWith("data:image/")) return value;
  return "";
}
/** Uploaded audio and video stream from the API origin; other values are HTTPS addresses. */
function mediaSource(value: string): string {
  if (runtimeMediaPath.test(value)) return "/api/v1/participant/settings/media?path=" + encodeURIComponent(value);
  return value.startsWith("https://") || value.startsWith("/api/") ? value : "";
}
/** Tab icons have selected variants for the three original tabs; menu icons use the line icon set. */
function icon(value: string, tab = false, active = false): string {
  if (miniappAssetPath.test(value)) return image(value);
  if (!(runtimeIcons as readonly string[]).includes(value)) return "asset:icons/activity";
  if (value === "discover" || tab && ["calendar", "account"].includes(value)) return `asset:tabs/${value}${active ? "-active" : ""}`;
  return `asset:icons/${value}`;
}
/** Image values inside actions become addresses the client can load. */
function act(action: RuntimeAction): RuntimeAction;
function act(action: RuntimeAction | undefined): RuntimeAction | null;
function act(action: RuntimeAction | undefined): RuntimeAction | null {
  if (!action) return null;
  if (action.type === "preview") return { ...action, images: action.images.map(image).filter(Boolean) };
  if (action.type === "save") return { ...action, image: image(action.image) };
  return action;
}
const text = (value: { zh: string; en: string } | undefined, context: Context) => runtimeLocalText(value, context.locale);
const link = (value: RuntimeLinkSpec | undefined, context: Context) => value ? { label: text(value.label, context), action: act(value.action) } : null;
const message = (state: "signedOut" | "error", context: Context) => text(state === "signedOut" ? runtimeStrings.signInPrompt : runtimeStrings.unavailable, context);

function sourceInput(block: RuntimeBlockSpec, context: Context): SourceInput {
  return { identity: context.identity, locale: context.locale, settings: context.published.settings, now: context.now, cursor: context.cursor,
    filters: { ...context.filters[runtimePageFilters], ...context.filters[block.id] }, params: block.type === "list" ? block.params : undefined };
}
/** Reads a display block's source. Visitors get `null` for personal sources; failures are reported on the block. */
async function display(block: RuntimeBlockSpec & { source?: string }, context: Context): Promise<{ data: DisplayData; state: "ready" | "signedOut" | "error" }> {
  if (!block.source) return { data: {}, state: "ready" };
  if (context.sample) return { data: sampleDisplay(block.source, context.locale), state: "ready" };
  try {
    const data = await readDisplay(block.source, sourceInput(block, context));
    return data ? { data, state: "ready" } : { data: {}, state: "signedOut" };
  } catch (error) {
    console.warn("Runtime display source failed", block.source, error instanceof Error ? error.message : error);
    return { data: {}, state: "error" };
  }
}
const stateMessage = (state: "ready" | "signedOut" | "error", context: Context) => state === "ready" ? "" : message(state, context);

async function children(rows: RuntimeBlockSpec[], context: Context) {
  return (await Promise.all(rows.map(row => view(row, context)))).filter((row): row is RuntimeBlockView => !!row);
}

async function view(block: RuntimeBlockSpec, context: Context): Promise<RuntimeBlockView | null> {
  if (!shown(block, context)) return null;
  if (runtimeBlockVersions[block.type] > context.client) return { id: block.id, type: "unsupported", fallback: text(runtimeStrings.updateRequired, context) };
  switch (block.type) {
    case "section": {
      const blocks = await children(block.blocks, context);
      return blocks.length ? { id: block.id, type: "section", title: text(block.title, context), style: block.style, more: link(block.more, context), blocks } : null;
    }
    case "tabs": {
      const tabs = await Promise.all(block.tabs.map(async tab => ({ id: tab.id, label: text(tab.label, context), blocks: await children(tab.blocks, context) })));
      return { id: block.id, type: "tabs", style: block.style, tabs };
    }
    case "collapse": {
      const blocks = await children(block.blocks, context);
      return blocks.length ? { id: block.id, type: "collapse", title: text(block.title, context), summary: text(block.summary, context), open: block.open, blocks } : null;
    }
    case "text": { const value = text(block.text, context); return value ? { id: block.id, type: "text", text: value, tone: block.tone } : null; }
    case "image": return image(block.image) ? { id: block.id, type: "image", image: image(block.image), fit: block.fit, action: act(block.action) } : null;
    case "feature": return { id: block.id, type: "feature", title: text(block.title, context), body: text(block.body, context), image: image(block.image),
      action: act(block.action), style: block.style ?? "card" };
    case "entries": {
      const items = block.items.filter(row => shown(row, context)).map(row => ({ id: row.id, label: text(row.label, context), icon: icon(row.icon), action: act(row.action) }));
      return items.length ? { id: block.id, type: "entries", title: text(block.title, context), style: block.style, items } : null;
    }
    case "list": {
      const base = { id: block.id, type: "list" as const, title: text(block.title, context), template: block.template, empty: text(block.empty, context), more: link(block.more, context) };
      try {
        const result = context.sample && block.source !== "activities.catalog"
          ? { items: sampleItems(block.source, context.locale), facets: [], next: "" }
          : await readSource(block.source, sourceInput(block, context));
        if (!result) return { ...base, items: [], facets: [], state: "signedOut", message: message("signedOut", context) };
        const items = result.items.slice(0, block.limit).map(row => ({ ...row, image: image(row.image), actionLabel: row.actionLabel || text(block.actionLabel, context) }));
        return { ...base, items, facets: result.facets.filter(row => block.facets.includes(row.id)), state: "ready", message: "", next: result.next || "" };
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
        const real = await readWeek(sourceInput(block, context), anchor);
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
    case "button": return { id: block.id, type: "button", label: text(block.label, context), appearance: block.appearance, action: act(block.action) };
    case "divider": return { id: block.id, type: "divider" };
    case "video": { const src = mediaSource(block.src); return src ? { id: block.id, type: "video", title: text(block.title, context), src, poster: image(block.poster) } : null; }
    case "audio": {
      const { data, state } = await display(block, context);
      const tracks = data.tracks ?? block.tracks.map(row => ({ id: row.id, title: text(row.title, context), subtitle: text(row.subtitle, context), src: row.src }));
      return { id: block.id, type: "audio", title: text(block.title, context), loop: block.loop, state, message: stateMessage(state, context),
        tracks: tracks.map(row => ({ ...row, src: mediaSource(row.src), cover: "" })).filter(row => row.src) };
    }
    case "card": {
      const { data, state } = await display(block, context), card = data.card;
      return { id: block.id, type: "card", style: block.style, title: card?.title ?? text(block.title, context), subtitle: card?.subtitle ?? text(block.subtitle, context),
        fields: card?.fields ?? block.fields.map(row => ({ label: text(row.label, context), value: text(row.value, context) })),
        image: image(card?.image ?? block.image), stamp: card?.stamp ?? text(block.stamp, context), action: act(block.action),
        refreshSeconds: block.refreshSeconds ?? 0, state, message: stateMessage(state, context) };
    }
    case "metrics": {
      const { data, state } = await display(block, context);
      return { id: block.id, type: "metrics", title: text(block.title, context), columns: block.columns, state, message: stateMessage(state, context),
        items: data.metrics ?? block.items.map(row => ({ label: text(row.label, context), value: row.value, unit: text(row.unit, context), hint: text(row.hint, context) })) };
    }
    case "chart": {
      const { data, state } = await display(block, context);
      const labels = data.chart?.labels ?? block.labels.map(row => text(row, context));
      const series = data.chart?.series ?? block.series.map(row => ({ name: text(row.name, context), values: row.values }));
      const drawn = chartImage(block.kind, labels, series, data.chart?.max ?? block.max);
      const legend = block.kind === "ring" && labels.length > 1 ? labels.map((label, index) => ({ label, color: segment(index) }))
        : series.length > 1 ? series.map((row, index) => ({ label: row.name, color: chartColors[index] })) : [];
      return { id: block.id, type: "chart", title: text(block.title, context), image: drawn.image, ratio: drawn.ratio, legend, caption: text(block.caption, context),
        state, message: stateMessage(state, context) };
    }
    case "progress": {
      const { data, state } = await display(block, context);
      const items = data.progress ?? block.items.map(row => ({ label: text(row.label, context), value: row.value, max: row.max, caption: text(row.caption, context) }));
      return { id: block.id, type: "progress", title: text(block.title, context), state, message: stateMessage(state, context),
        items: items.map(row => ({ ...row, percent: Math.round(Math.max(0, Math.min(1, row.value / (row.max || 1))) * 100) })) };
    }
    case "badges": {
      const { data, state } = await display(block, context);
      const items = data.badges ?? block.items.map(row => ({ id: row.id, label: text(row.label, context), image: row.image, earned: row.earned, caption: text(row.caption, context) }));
      return { id: block.id, type: "badges", title: text(block.title, context), columns: block.columns, state, message: stateMessage(state, context),
        items: items.map(row => ({ ...row, image: image(row.image) || "asset:icons/complete", action: null })) };
    }
    case "table": {
      const { data, state } = await display(block, context);
      return { id: block.id, type: "table", title: text(block.title, context), state, message: stateMessage(state, context),
        columns: data.table?.columns ?? block.columns.map(row => text(row, context)), rows: data.table?.rows ?? block.rows.map(row => row.map(cell => text(cell, context))) };
    }
    case "form": {
      // Staff previews use the draft form; families read the published form through its audience check.
      const found = context.draft ? { form: context.published.settings.experience?.forms.find(row => row.id === block.formId && row.enabled) ?? null, revision: context.published.settingsRevision }
        : await readForm(block.formId, context.identity);
      const form = found.form;
      if (!form) return context.identity.signedIn ? null : { id: block.id, type: "form", title: text(block.title, context), intro: "", command: "", params: {},
        submitLabel: "", groups: [], after: null, state: "signedOut", message: message("signedOut", context) };
      const signedIn = context.identity.signedIn;
      return { id: block.id, type: "form", title: text(block.title, context) || text(form.title, context), intro: text(form.introduction, context),
        command: block.command || "form.submit", params: { formId: form.id, revision: String(found.revision) },
        submitLabel: text(block.submitLabel, context) || text(form.submitLabel, context) || text(runtimeStrings.submit, context),
        groups: runtimeFormGroups(form, context.locale), after: act(block.after), state: signedIn ? "ready" : "signedOut", message: signedIn ? "" : message("signedOut", context) };
    }
    case "bar": return { id: block.id, type: "bar", buttons: block.buttons.map(row => ({ id: row.id, label: text(row.label, context), appearance: row.appearance, action: act(row.action) })) };
  }
}

export async function runtimeContext(request: Request): Promise<Context & { params: URLSearchParams }> {
  const input = query(request);
  const [published, identity] = await Promise.all([readPublishedRuntime(), loadIdentity(request, input.participant)]);
  return { published, identity, locale: input.locale, client: input.client, now: Date.now(), filters: input.filters, anchor: input.anchor || "", cursor: input.cursor, params: input.params };
}
const privateHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

function tabsFor(value: Context): RuntimeTab[] {
  return value.published.spec.tabs.filter(row => shown(row, value) && value.published.spec.screens.some(screen => screen.id === row.screen))
    .sort((a, b) => a.slot - b.slot).map(row => ({ slot: row.slot, label: text(row.label, value), icon: icon(row.icon, true), activeIcon: icon(row.icon, true, true), screen: row.screen }));
}
export async function runtimeAppGet(request: Request) {
  const value = await runtimeContext(request);
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
  const walk = (rows: RuntimeBlockView[]) => rows.forEach(row => { if (row.type === "list") lists.push(row); else walk(runtimeChildren(row)); });
  walk(blocks);
  const facets = lists.find(row => row.facets.length)?.facets ?? [];
  const hasBar = blocks.some(row => row.type === "filters");
  const place = (rows: RuntimeBlockView[]): RuntimeBlockView[] => rows.flatMap((row): RuntimeBlockView[] => {
    if (row.type === "filters") return facets.length ? [{ ...row, facets, active: facets.some(facet => !!facet.value) }] : [];
    if (row.type === "list" && hasBar) return [{ ...row, facets: [] }];
    if (row.type === "section" || row.type === "collapse") return [{ ...row, blocks: place(row.blocks) }];
    if (row.type === "tabs") return [{ ...row, tabs: row.tabs.map(tab => ({ ...tab, blocks: place(tab.blocks) })) }];
    return [row];
  });
  return place(blocks);
}
async function screenView(value: Context, id: string | null): Promise<RuntimeScreen> {
  const screen = findScreen(value.published.spec, id);
  const blocks = placeFilters(await children(screen.blocks, value));
  return { id: screen.id, revision: value.published.revision, signedIn: value.identity.signedIn, participant: value.identity.participant,
    title: screen.navigation === "brand" ? text(screen.title, value) || text(value.published.settings.brand.name, value) : text(screen.title, value),
    navigation: screen.navigation, blocks, participants: value.identity.participants.map(row => ({ id: row.id, name: row.name })), share: screen.share ? { title: text(screen.share.title, value) || text(screen.title, value), image: image(screen.share.image) } : null };
}
export async function runtimeScreenGet(request: Request) {
  const value = await runtimeContext(request);
  return Response.json(await screenView(value, value.params.get("id")), { headers: privateHeaders });
}

/** Renders a draft for the staff canvas: visitors see real public data, the signed-in view uses example records only.
 * Draft settings replace the published ones so unpublished names, stages and forms appear on the canvas. */
export async function previewRuntimeScreen(spec: RuntimeSpec, screenId: string, mode: "visitor" | "member", locale: RuntimeLocale,
  draft?: Partial<Pick<MiniappSettings, "brand" | "stages">> & { forms?: ExperienceForm[] }) {
  const live = await readPublishedRuntime(), published = live.settings;
  const settings: MiniappSettings = draft ? { ...published, ...(draft.brand ? { brand: draft.brand } : {}), ...(draft.stages ? { stages: draft.stages } : {}),
    ...(draft.forms ? { experience: { ...(published.experience ?? defaultMiniappExperience(published)), forms: draft.forms } } : {}) } : published;
  const identity: RuntimeIdentity = mode === "member"
    ? { signedIn: true, db: null, name: locale === "zh" ? "示例家长" : "Example parent", participants: sampleParticipants, participant: sampleParticipants[0].id, stage: 3 }
    : { signedIn: false, db: null, name: "", participants: [], participant: null, stage: null };
  const value: Context = { published: { revision: "draft", spec, settings, settingsRevision: live.settingsRevision }, identity, locale, client: runtimeClientVersion,
    now: Date.now(), filters: {}, anchor: "", cursor: "", sample: mode === "member", draft: true };
  return { screen: await screenView(value, screenId), tabs: tabsFor(value) };
}

function findBlock(blocks: RuntimeBlockSpec[], id: string): RuntimeBlockSpec | null {
  for (const block of blocks) {
    if (block.id === id) return block;
    const found = findBlock(runtimeChildren(block), id);
    if (found) return found;
  }
  return null;
}
/** Refreshes one block, for example after choosing a filter, another calendar week or the next page of a list. */
export async function runtimeBlockGet(request: Request) {
  const value = await runtimeContext(request);
  const block = findBlock(findScreen(value.published.spec, value.params.get("screen")).blocks, value.params.get("block") || "");
  if (!block) throw new PortalError("NOT_FOUND");
  return Response.json({ revision: value.published.revision, block: await view(block, value) }, { headers: privateHeaders });
}
export { findBlock as findRuntimeBlock, findScreen as findRuntimeScreen };
