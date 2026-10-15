import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { authorize, PortalError, readBytes, readJson, requireResult, response } from "@/features/parent-portal/server";
import type { RegistrationRpc } from "@/features/parent-portal/course-server";
import { mediaType } from "@/features/parent-portal/validation";
import { getMiniappWechatConfig } from "@/features/wechat/miniapp-config";
import { exchangeMiniappWechatCode } from "@/features/wechat/miniapp-provider";
import { findWechatUser, issueTicket } from "@/features/wechat/store";
import { experienceAnswersSchema } from "../experience-requests-server";
import { loadIdentity, readForm } from "./server";
import { shanghaiDate } from "./sources";
import type { RuntimeEffect, RuntimeLocale } from "../../../../contracts/participant-api/runtime";
import type { ExperienceForm } from "../../../../contracts/participant-api/miniapp-experience";
import type { RuntimeIdentity } from "./sources";

const id = z.string().uuid();
const commandSchema = z.object({
  id, command: z.string().regex(/^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*){0,3}$/).max(64),
  params: z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/), z.string().max(200)).refine(v => Object.keys(v).length <= 12).default({}),
  values: experienceAnswersSchema.optional(), screen: z.string().max(64).default(""), block: z.string().max(64).default(""),
  participant: z.union([id, z.literal("")]).default(""), locale: z.enum(["zh", "en"]).default("zh"),
}).strict();
type Command = z.infer<typeof commandSchema>;
type Handler = (input: Command, identity: RuntimeIdentity & { db: NonNullable<RuntimeIdentity["db"]> }, userId: string) => Promise<RuntimeEffect[]>;
const t = (locale: RuntimeLocale, zh: string, en: string) => locale === "zh" ? zh : en;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Every file answer must refer to the account's own stored uploads. */
async function assertUploads(form: ExperienceForm, values: Command["values"], userId: string) {
  const ids = [...new Set(form.groups.flatMap(group => (values?.[group.id] ?? []).flatMap(row => group.fields.filter(field => field.type === "media")
    .flatMap(field => { const value = row[field.id]; return Array.isArray(value) ? value : []; }))))];
  if (!ids.length) return;
  if (ids.some(value => !uuidPattern.test(value))) throw new PortalError("VALIDATION");
  const rows = requireResult(await createAdminClient().from("miniapp_runtime_uploads").select("id").in("id", ids).eq("owner_id", userId).eq("ready", true));
  if ((rows ?? []).length !== ids.length) throw new PortalError("VALIDATION");
}

/** Commands are registered here. Adding a command changes only Mathin; clients run the effects it returns. */
const handlers: Record<string, Handler> = {
  /** Submits a form from the form library. Staff see it in service requests; the family sees it in their requests list. */
  async "form.submit"(input, identity, userId) {
    const formId = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).parse(input.params.formId);
    // Read as the family so the form's audience applies; the database checks the answers again on submit.
    const { form, revision } = await readForm(formId, identity);
    if (!form) throw new PortalError("NOT_FOUND");
    if (input.params.revision && Number(input.params.revision) !== revision) throw new PortalError("FORM_CHANGED");
    await assertUploads(form, input.values, userId);
    const participant = identity.participants.some(row => row.id === input.participant) ? input.participant : "";
    requireResult(await (identity.db.rpc as unknown as RegistrationRpc)("miniapp_submit_experience_request", {
      p_id: input.id, p_service_id: "", p_form_id: formId, p_revision: revision, p_answers: input.values ?? {},
      p_participant_ids: participant ? [participant] : [], p_consents: {} }));
    const success = form.successMessage[input.locale] || form.successMessage.zh;
    return [{ type: "reset" }, { type: "toast", text: t(input.locale, "已提交", "Submitted"), icon: "success" },
      ...(success ? [{ type: "dialog" as const, title: t(input.locale, "已提交", "Submitted"), body: success, confirm: t(input.locale, "知道了", "OK") }] : []),
      { type: "refresh" }];
  },
  /** One check-in per child per day; the reveal shows how many days this week. */
  async checkin(input, identity) {
    const participant = identity.participants.some(row => row.id === input.participant) ? input.participant : identity.participant;
    const today = shanghaiDate(Date.now()), start = new Date(Date.parse(today + "T00:00:00+08:00")).toISOString();
    let query = identity.db.from("miniapp_runtime_events").select("id").eq("command", "checkin").gte("created_at", start).limit(1);
    if (participant) query = query.eq("participant_id", participant);
    const done = (requireResult(await query) ?? []).length > 0;
    if (!done) requireResult(await (identity.db.rpc as unknown as RegistrationRpc)("miniapp_record_runtime_event", {
      p_id: input.id, p_command: "checkin", p_participant: participant, p_payload: { title: input.params.title || t(input.locale, "今日打卡", "Check-in"), date: today } }));
    return done ? [{ type: "toast", text: t(input.locale, "今天已经打过卡了", "Already checked in today") }]
      : [{ type: "reveal", style: "badge", title: t(input.locale, "打卡成功", "Checked in"), body: input.params.message || t(input.locale, "坚持就是进步！", "Keep going!"), image: "asset:icons/complete" },
        { type: "refresh" }];
  },
  /** Records which subscription messages the family accepted, so later notices can use them. */
  async "subscriptions.record"(input, identity) {
    const accepted = (input.params.accepted || "").split(",").filter(v => /^[A-Za-z0-9_-]{8,64}$/.test(v)).slice(0, 3);
    if (accepted.length) requireResult(await (identity.db.rpc as unknown as RegistrationRpc)("miniapp_record_runtime_event", {
      p_id: input.id, p_command: "subscriptions.record", p_participant: null, p_payload: { accepted } }));
    return accepted.length ? [{ type: "toast", text: t(input.locale, "已开启提醒", "Reminders on"), icon: "success" }] : [];
  },
};

export async function runtimeCommandPost(request: Request) {
  const input = commandSchema.parse(await readJson(request));
  const handler = Object.hasOwn(handlers, input.command) ? handlers[input.command] : null;
  if (!handler) throw new PortalError("NOT_FOUND");
  const { user } = await authorize(request);
  const identity = await loadIdentity(request, input.participant || null);
  if (!identity.db) throw new PortalError("UNAUTHENTICATED");
  return response({ effects: await handler(input, { ...identity, db: identity.db }, user.id) });
}

/** Scanned codes and launch scenes. Mathin addresses open as signed-in web pages; other codes are explained. */
export async function runtimeResolveGet(request: Request) {
  const params = new URL(request.url).searchParams, code = (params.get("code") || "").slice(0, 500), locale = params.get("locale") === "en" ? "en" : "zh";
  const site = (process.env.NEXT_PUBLIC_SITE_URL || "https://mathin.club").replace(/\/$/, "");
  let effects: RuntimeEffect[] = [];
  try {
    const url = new URL(code);
    if (url.origin === site && /^\/(?:zh|en)(?:\/|$)/.test(url.pathname)) effects = [{ type: "action", action: { type: "web", url: url.pathname + url.search, signIn: true } }];
  } catch { /* Not an address. */ }
  if (!effects.length && params.get("kind") === "scan") effects = [{ type: "toast", text: t(locale, "无法识别这个码", "This code is not recognised") }];
  return response({ effects });
}

/** A one-minute ticket that signs the web page in as this account. A fresh WeChat code proves the same person is present. */
export async function runtimeWebTicketPost(request: Request) {
  const input = z.object({ code: z.string().min(1).max(200), url: z.string().max(500).regex(/^\/(?:zh|en)(?:\/[^\s"'<>]*)?$/) }).strict().parse(await readJson(request));
  if (input.url.startsWith("//") || input.url.includes("\\")) throw new PortalError("VALIDATION");
  const { user } = await authorize(request);
  const config = getMiniappWechatConfig();
  if (!config) throw new PortalError("UNAVAILABLE");
  await limit(request, "web-ticket:" + user.id, 20);
  const identity = await exchangeMiniappWechatCode(config, input.code);
  if (await findWechatUser(identity.subject) !== user.id) throw new PortalError("FORBIDDEN");
  const token = await issueTicket("miniapp_web", { userId: user.id, identity, next: input.url }, "miniapp-web", 60);
  const locale = input.url.slice(1, 3);
  return response({ url: `${config.siteOrigin}/${locale}/auth/miniapp?ticket=${encodeURIComponent(token)}` });
}

async function limit(request: Request, scope: string, count: number) {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) throw new PortalError("UNAVAILABLE");
  const key = createHmac("sha256", secret).update("runtime:" + scope).digest("hex");
  if (!requireResult(await createAdminClient().rpc("miniapp_take_rate_limit", { p_key: key, p_limit: count, p_seconds: 600 }))) throw new PortalError("RATE_LIMIT");
  void request;
}

const UPLOAD_BYTES = { image: 20 * 1024 * 1024, video: 64 * 1024 * 1024, file: 20 * 1024 * 1024 } as const;
/** Stores one file chosen in a runtime form. The answer refers to it by id; staff read it through the request. */
export async function runtimeUploadPost(request: Request) {
  const { user } = await authorize(request);
  await limit(request, "upload:" + user.id, 60);
  const body = await readBytes(request, UPLOAD_BYTES.video + 256 * 1024);
  let data: FormData;
  try { data = await new Request(request.url, { method: "POST", headers: { "content-type": request.headers.get("content-type") || "" }, body }).formData(); }
  catch { throw new PortalError("VALIDATION"); }
  const file = data.get("file");
  if (!(file instanceof File) || file.size === 0) throw new PortalError("VALIDATION");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const detected = mediaType(bytes);
  const format = detected ?? (String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-" ? { mime: "application/pdf", extension: "pdf", kind: "file" as const } : null);
  if (!format) throw new PortalError("FILE_TYPE");
  if (file.size > UPLOAD_BYTES[format.kind]) throw new PortalError("TOO_LARGE");
  const uploadId = randomUUID(), objectPath = `${user.id}/${uploadId}.${format.extension}`;
  const name = (file.name || "").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 200) || `${format.kind}.${format.extension}`;
  const admin = createAdminClient();
  requireResult(await admin.from("miniapp_runtime_uploads").insert({ id: uploadId, owner_id: user.id, object_path: objectPath, name, kind: format.kind, mime_type: format.mime, bytes: file.size }));
  const stored = await admin.storage.from("miniapp-runtime-uploads").upload(objectPath, bytes, { contentType: format.mime, upsert: false });
  if (stored.error) { await admin.from("miniapp_runtime_uploads").delete().eq("id", uploadId); throw new PortalError("UNAVAILABLE"); }
  requireResult(await admin.from("miniapp_runtime_uploads").update({ ready: true }).eq("id", uploadId));
  return response({ id: uploadId, kind: format.kind, name, bytes: file.size }, 201);
}
