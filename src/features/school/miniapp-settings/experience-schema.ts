import { z } from "zod";
import { bookingEvents, contentBlockKinds, providerCapabilities, type MiniappExperience } from "../../../../contracts/participant-api/miniapp-experience";

export const experienceId = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).refine(v => !["__proto__", "prototype", "constructor"].includes(v), "Reserved identifier");
const reference = z.union([experienceId, z.literal("")]);
const text = (max = 4000) => z.object({ zh: z.string().max(max), en: z.string().max(max) }).strict();
const image = z.string().regex(/^(?:|[0-9a-f-]{36}\.webp)$/);
const audience = z.enum(["all", "signedIn", "participants"]);
const unique = <T extends { id: string }>(items: T[]) => new Set(items.map(v => v.id)).size === items.length;
const list = <T extends z.ZodType<{ id: string }>>(schema: T, max = 50) => z.array(schema).max(max).refine(unique, "Identifiers must be unique");
export const experienceActionSchema = z.object({ kind: z.enum(["none", "native", "page", "offering", "catalog", "form", "web", "phone"]), target: z.string().max(128), label: text(120) }).strict();
const condition = z.object({ field: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.]{0,80}$/), operator: z.enum(["present", "equals", "notEquals"]), value: z.string().max(200) }).strict();
const binding = z.string().regex(/^(?:|[a-zA-Z][a-zA-Z0-9_.]{0,80})$/);
const base = { id: experienceId, version: z.literal(1), visible: z.boolean(), condition: condition.optional(), fallback: text().optional() };
const item = z.object({ id: experienceId, title: text(200), body: text(), image: image.optional(), binding: binding.optional() }).strict();
const block = z.discriminatedUnion("kind", [
  z.object({ ...base, kind: z.literal("heading"), text: text(200), level: z.union([z.literal(2), z.literal(3)]) }).strict(),
  z.object({ ...base, kind: z.enum(["paragraph", "callout", "quote"]), text: text(12000), binding, tone: z.enum(["neutral", "accent", "notice"]) }).strict(),
  z.object({ ...base, kind: z.literal("image"), image, caption: text(500), fit: z.enum(["contain", "cover"]) }).strict(),
  z.object({ ...base, kind: z.enum(["bullets", "steps", "facts", "faq"]), title: text(200), items: list(item, 40), binding }).strict(),
  z.object({ ...base, kind: z.literal("table"), title: text(200), columns: z.array(text(100)).max(8), rows: z.array(z.array(text(1000)).max(8)).max(60), binding }).strict(),
  z.object({ ...base, kind: z.literal("action"), action: experienceActionSchema, appearance: z.enum(["primary", "secondary", "link"]) }).strict(),
  z.object({ ...base, kind: z.literal("divider") }).strict(),
  z.object({ ...base, kind: z.enum(["services", "activities", "contacts"]), title: text(200), ids: z.array(experienceId).max(50), limit: z.number().int().min(1).max(30), emptyText: text(500), layout: z.enum(["list", "grid"]) }).strict(),
  z.object({ ...base, kind: z.literal("metric"), title: text(200), binding, unit: text(50), description: text(1000) }).strict(),
  z.object({ ...base, kind: z.literal("scale"), title: text(200), binding, labels: z.array(text(100)).min(2).max(10), description: text(1000) }).strict(),
  z.object({ ...base, kind: z.literal("evidence"), title: text(200), binding, emptyText: text(500) }).strict(),
  z.object({ ...base, kind: z.literal("chart"), title: text(200), binding, chart: z.enum(["donut", "bars", "radar", "trend"]), description: text(1000) }).strict(),
]);
export const contentDocumentSchema = z.object({ id: experienceId, version: z.literal(1), title: text(200), description: text(1000),
  purpose: z.enum(["page", "service", "preparation", "confirmation", "report", "help"]), audience, enabled: z.boolean(), layout: z.enum(["reading", "sections"]), blocks: list(block, 80) }).strict();
const formCondition = z.object({ fieldId: experienceId, operator: z.enum(["equals", "notEquals", "answered", "includes"]), value: z.string().max(200) }).strict();
const field = z.object({ id: experienceId, type: z.enum(["text", "textarea", "phone", "email", "number", "date", "select", "multiselect", "consent"]),
  label: text(200), help: text(1000), placeholder: text(200), required: z.boolean(), options: list(z.object({ id: experienceId, label: text(200) }).strict(), 30),
  visibleWhen: formCondition.optional(), min: z.number().finite().optional(), max: z.number().finite().optional(),
}).strict();
export const experienceFormSchema = z.object({ id: experienceId, version: z.literal(1), title: text(200), introduction: text(4000),
  submitLabel: text(120), successMessage: text(2000), audience, enabled: z.boolean(), purpose: z.enum(["intake", "request", "feedback", "followup"]),
  groups: list(z.object({ id: experienceId, title: text(200), description: text(1000), repeat: z.boolean(), minEntries: z.number().int().min(0).max(10),
    maxEntries: z.number().int().min(1).max(10), fields: list(field, 40) }).strict(), 20),
}).strict();
/** HTTPS destinations are explicit public websites. Login credentials are never accepted in URLs. */
export function publicWebsiteUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && !url.username && !url.password && (!url.port || url.port === "443")
      && !host.endsWith(".local") && !host.endsWith(".internal") && host !== "localhost"
      && !/^\[|^[\d.]+$/.test(host) && host.includes(".")
      && !/[\u0000-\u0020\\]/.test(value) && ![...url.searchParams.keys()].some(k => /^(?:token|access_token|refresh_token|id_token|authorization|password|secret|jwt|api_?key)$/i.test(k))
      && !/(?:^#|[&?])(?:access_token|refresh_token|id_token|token|password|secret)=/i.test(url.hash);
  } catch { return false; }
}
export const webDestinationSchema = z.object({ id: experienceId, name: text(200), url: z.string().max(2000).refine(v => !v || publicWebsiteUrl(v), "Use a public HTTPS website without credentials"),
  enabled: z.boolean(), domainConfirmed: z.boolean(), openMode: z.enum(["webview", "copy"]), allowedParameters: z.array(z.enum(["locale", "source", "service"])).max(3),
  returnPageId: reference, unavailableMessage: text(2000) }).strict();
const resource = z.object({ id: experienceId, kind: z.enum(["person", "location", "room", "equipment", "online"]), name: text(200), description: text(4000), image, address: text(1000),
  capacity: z.number().int().min(1).max(10000), enabled: z.boolean(), connectionId: reference, externalId: z.string().max(200) }).strict();
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const minutes = z.number().int().min(0).max(525600);
const policy = z.object({ id: experienceId, name: text(200), timeZone: z.string().max(100).refine(v => { try { new Intl.DateTimeFormat("en", { timeZone: v }); return true; } catch { return false; } }),
  windowDays: z.number().int().min(1).max(366), minimumNoticeMinutes: minutes, bufferBeforeMinutes: minutes, bufferAfterMinutes: minutes,
  slotMinutes: z.number().int().min(5).max(1440), capacity: z.number().int().min(1).max(10000), maxActiveBookings: z.number().int().min(1).max(1000),
  cancellation: z.enum(["self", "contact", "disabled"]), cancellationCutoffMinutes: minutes, reschedule: z.enum(["self", "contact", "disabled"]), rescheduleCutoffMinutes: minutes,
  waitlist: z.boolean(), confirmation: z.enum(["automatic", "manual"]),
  weekdays: z.array(z.object({ day: z.number().int().min(0).max(6), start: time, end: time }).strict()).max(28),
  exceptions: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), closed: z.boolean(), start: time, end: time, note: text(500) }).strict()).max(100),
}).strict();
const flow = z.object({ id: experienceId, name: text(200), mode: z.enum(["appointment", "request", "activity", "external"]), formId: reference,
  preparationPageId: reference, confirmationPageId: reference, requireParticipant: z.boolean(), allowMultipleParticipants: z.boolean(), policyId: reference,
  consentDocumentIds: z.array(experienceId).max(10), completionAction: experienceActionSchema }).strict();
const service = z.object({ id: experienceId, name: text(200), summary: text(2000), image, enabled: z.boolean(), categoryId: reference, audienceTags: z.array(experienceId).max(30),
  durationMinutes: z.number().int().min(0).max(1440), detailPageId: reference, flowId: reference, resourceIds: z.array(experienceId).max(30),
  binding: z.object({ adapter: z.enum(["mathin-assessment", "mathin-activity", "request", "remote", "web"]), target: z.string().max(200), connectionId: reference }).strict(),
  price: z.object({ mode: z.enum(["free", "offline", "online"]), amountMinor: z.number().int().min(0).max(100000000), currency: z.string().regex(/^[A-Z]{3}$/), note: text(1000) }).strict(),
}).strict();
export const miniappExperienceSchema: z.ZodType<MiniappExperience> = z.object({ version: z.literal(1), homePageId: reference,
  pages: list(contentDocumentSchema), forms: list(experienceFormSchema), services: list(service, 100), destinations: list(webDestinationSchema),
  dictionaries: list(z.object({ id: experienceId, name: text(200), entries: list(z.object({ id: experienceId, label: text(200), enabled: z.boolean() }).strict(), 100) }).strict(), 20),
  resources: list(resource, 100), policies: list(policy), flows: list(flow),
  connections: list(z.object({ id: experienceId, name: text(200), adapter: z.enum(["mathin", "http-v1"]), capabilities: z.array(z.enum(providerCapabilities)).max(providerCapabilities.length), enabled: z.boolean() }).strict(), 30),
  notifications: list(z.object({ id: experienceId, name: text(200), event: z.enum(bookingEvents), channel: z.enum(["inApp", "wechat", "email", "sms", "webhook"]), enabled: z.boolean(),
    connectionId: reference, templateKey: z.string().max(200), serviceIds: z.array(experienceId).max(100), offsetMinutes: z.number().int().min(-525600).max(525600), title: text(200), body: text(4000) }).strict(), 100),
  reportBindings: z.array(z.object({ kind: z.enum(["assessment", "feedback"]), pageId: reference, serviceId: reference, enabled: z.boolean() }).strict()).max(30),
}).strict().refine(value => new TextEncoder().encode(JSON.stringify(value)).length <= 1024 * 1024, "Configuration is larger than 1 MiB");

export const knownContentKinds = new Set<string>(contentBlockKinds);
