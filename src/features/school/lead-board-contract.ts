import { z } from "zod";

/* 六级灯色：与教学进度的灰、红、橙、黄、绿、蓝阶梯同序。 */
export const LEAD_LIGHTS = ["gray", "red", "orange", "yellow", "green", "blue"] as const;
export type LeadLight = typeof LEAD_LIGHTS[number];
export const LEAD_LIGHT_DOT: Record<LeadLight, string> = {
  gray: "bg-crater/40", red: "bg-rose", orange: "bg-orange-500", yellow: "bg-yellow-400", green: "bg-leaf", blue: "bg-sky-500",
};
export const LEAD_LANES = ["support", "teach", "assess"] as const;
export type LeadLane = typeof LEAD_LANES[number];

const num = z.number().int().nullable();
export const leadBoardSchema = z.object({
  units: z.array(z.object({ id: z.string().uuid(), name: z.string(), parentId: z.string().uuid().nullable(), kind: z.string() })),
  unitId: z.string().uuid().nullable(),
  canManageRules: z.boolean().default(false),
  members: z.array(z.object({ id: z.string().uuid(), name: z.string(), unitId: z.string().uuid(), lead: z.boolean(), roles: z.array(z.string()),
    weekContacts: z.number().int(), weekEffective: z.number().int() })),
  support: z.array(z.object({ key: z.string(), name: z.string(), ownerId: z.string().uuid(), stage: z.string(), detail: z.string().nullable(),
    sinceContact: num, sinceAttempt: num, lastResult: z.string().nullable(), summaryLength: z.number().int(), attempts7d: z.number().int(), nextDueInDays: num })),
  teach: z.array(z.object({ key: z.string(), name: z.string(), ownerId: z.string().uuid(), classId: z.string().uuid(), className: z.string(),
    learningLogged: z.boolean().nullable(), hoursSinceLesson: num, sinceContact: z.number().int(), contactedEver: z.boolean(),
    label: z.enum(["A", "B", "C", "D"]).nullable().default(null) })),
  assess: z.array(z.object({ key: z.string(), name: z.string(), ownerId: z.string().uuid(), scheduledAt: z.string(),
    step: z.enum(["arrival", "record", "explain", "done"]), hoursOver: z.number().int() })),
  rules: z.record(z.string(), z.object({ config: z.unknown(), unitId: z.string().uuid(), updatedAt: z.string() })).default({}),
  period: z.object({ grain: z.enum(["week", "month"]), from: z.string(), to: z.string(), asOf: z.string(), isCurrent: z.boolean() }),
});
export type LeadGrain = "week" | "month";
export type LeadBoard = z.infer<typeof leadBoardSchema>;
export const leadSubjectSchema = z.object({ records: z.array(z.object({ at: z.string(), kind: z.string(), outcome: z.string().nullable(), note: z.string(), by: z.string().nullable() })) });
export type LeadSubject = z.infer<typeof leadSubjectSchema>;

/* ---------- 规则 ---------- */
export type LeadOp = ">" | ">=" | "<" | "<=" | "=" | "in" | "notin" | "is";
export type LeadCondition = [string, LeadOp, string | number | boolean];
export type LeadRule = { color: LeadLight; all: LeadCondition[] };
export type LeadRuleConfig = { rules: LeadRule[]; else: LeadLight; cadence: Record<string, number> };
export const leadRuleConfigSchema: z.ZodType<LeadRuleConfig> = z.object({
  rules: z.array(z.object({ color: z.enum(LEAD_LIGHTS),
    all: z.array(z.tuple([z.string().max(40), z.enum([">", ">=", "<", "<=", "=", "in", "notin", "is"]), z.union([z.string().max(40), z.number(), z.boolean()])])).max(6) })).max(30),
  else: z.enum(LEAD_LIGHTS),
  cadence: z.record(z.string(), z.number().int().min(0).max(365)),
});

export type LeadFieldDef = { key: string; type: "num" | "enum" | "bool"; unit?: string; options?: readonly string[] };
export const LEAD_FIELDS: Record<LeadLane, LeadFieldDef[]> = {
  support: [
    { key: "cluster", type: "enum", options: ["first", "assess", "after", "enroll", "serve", "renew", "other"] },
    { key: "cadenceOver", type: "num", unit: "day" }, { key: "sinceContact", type: "num", unit: "day" },
    { key: "neverContacted", type: "bool" }, { key: "attempts7d", type: "num", unit: "times" },
    { key: "lastResult", type: "enum", options: ["connected", "unreachable", "declined", "invalid_number", "none"] },
    { key: "summaryLength", type: "num", unit: "chars" }, { key: "hasNext", type: "bool" }, { key: "nextOverdue", type: "bool" },
    { key: "paused", type: "bool" },
  ],
  teach: [
    { key: "label", type: "enum", options: ["A", "B", "C", "D", "none"] },
    { key: "learningLogged", type: "bool" }, { key: "hoursSinceLesson", type: "num", unit: "hour" },
    { key: "contactOver", type: "num", unit: "day" }, { key: "sinceContact", type: "num", unit: "day" }, { key: "contactedEver", type: "bool" },
  ],
  assess: [
    { key: "step", type: "enum", options: ["arrival", "record", "explain", "done"] }, { key: "hoursOver", type: "num", unit: "hour" },
  ],
};
export const LEAD_OPS: Record<LeadFieldDef["type"], LeadOp[]> = { num: [">", ">=", "<", "<=", "="], enum: ["in", "notin"], bool: ["is"] };

/* 标准规则：组长只需调整几个天数或小时数，规则按固定模板生成；参数与间隔一起存放在 cadence 中（以 _ 开头）。 */
export const LEAD_STANDARD_PARAMS: Record<LeadLane, Record<string, number>> = {
  support: { first: 1, assess: 7, after: 2, enroll: 3, serve: 30, renew: 7, other: 30, _red: 7, _warn: 1, _quality: 30 },
  teach: { A: 7, B: 14, C: 30, D: 30, none: 30, _learnLate: 24, _learnVeryLate: 48, _red: 14, _warn: 3 },
  assess: { _red: 24 },
};
export const LEAD_INTERVAL_KEYS: Record<LeadLane, string[]> = {
  support: ["first", "assess", "after", "enroll", "serve", "renew", "other"], teach: ["A", "B", "C", "D", "none"], assess: [],
};
export const LEAD_PARAM_KEYS: Record<LeadLane, string[]> = {
  support: ["_red", "_warn", "_quality"], teach: ["_learnLate", "_learnVeryLate", "_red", "_warn"], assess: ["_red"],
};
export function standardLeadRules(lane: LeadLane, cadence: Record<string, number>): LeadRuleConfig {
  const p = { ...LEAD_STANDARD_PARAMS[lane], ...cadence };
  const rules: LeadRule[] = lane === "support" ? [
    { color: "gray", all: [["paused", "is", true]] },
    { color: "red", all: [["neverContacted", "is", true], ["attempts7d", "=", 0]] },
    { color: "orange", all: [["neverContacted", "is", true]] },
    { color: "red", all: [["cadenceOver", ">", p._red]] },
    { color: "orange", all: [["cadenceOver", ">", 0]] },
    { color: "orange", all: [["nextOverdue", "is", true]] },
    { color: "yellow", all: [["cadenceOver", ">=", -p._warn]] },
    { color: "blue", all: [["lastResult", "in", "connected"], ["summaryLength", ">=", p._quality], ["hasNext", "is", true]] },
    { color: "green", all: [["lastResult", "in", "connected"]] },
  ] : lane === "teach" ? [
    { color: "red", all: [["learningLogged", "is", false], ["hoursSinceLesson", ">", p._learnVeryLate]] },
    { color: "orange", all: [["learningLogged", "is", false], ["hoursSinceLesson", ">", p._learnLate]] },
    { color: "red", all: [["contactOver", ">", p._red]] },
    { color: "orange", all: [["contactOver", ">", 0]] },
    { color: "yellow", all: [["contactOver", ">=", -p._warn]] },
    { color: "yellow", all: [["learningLogged", "is", false]] },
    { color: "blue", all: [["learningLogged", "is", true], ["contactedEver", "is", true]] },
    { color: "green", all: [["contactedEver", "is", true]] },
  ] : [
    { color: "red", all: [["hoursOver", ">", p._red]] },
    { color: "orange", all: [["hoursOver", ">", 0]] },
    { color: "gray", all: [["step", "in", "arrival"]] },
    { color: "yellow", all: [["step", "notin", "done"]] },
    { color: "green", all: [["step", "in", "done"]] },
  ];
  return { rules, else: "gray", cadence: p };
}
export function isStandardLeadRules(lane: LeadLane, config: LeadRuleConfig) {
  const standard = standardLeadRules(lane, config.cadence);
  return config.else === standard.else && JSON.stringify(config.rules) === JSON.stringify(standard.rules);
}
export const DEFAULT_LEAD_RULES: Record<LeadLane, LeadRuleConfig> = {
  support: standardLeadRules("support", {}), teach: standardLeadRules("teach", {}), assess: standardLeadRules("assess", {}),
};

export function resolveLeadRules(board: LeadBoard, lane: LeadLane): LeadRuleConfig {
  const parsed = leadRuleConfigSchema.safeParse(board.rules[lane]?.config);
  if (!parsed.success) return DEFAULT_LEAD_RULES[lane];
  return { ...parsed.data, cadence: { ...DEFAULT_LEAD_RULES[lane].cadence, ...parsed.data.cadence } };
}

/* ---------- 事实字段 ---------- */
const PAUSED_DETAILS = new Set(["invalid_number", "not_enrolling", "not_renewing", "renewal_confirmed", "nurturing"]);
export function supportCluster(stage: string, detail: string | null) {
  if (stage === "awaiting_first_contact") return "first";
  if (stage === "awaiting_assessment") return detail === "attended_without_result" ? "after" : "assess";
  if (stage === "awaiting_enrollment") return detail === "assessed" ? "after" : "enroll";
  if (stage === "awaiting_renewal") return detail?.startsWith("renewal") || detail === "not_renewing" ? "renew" : "serve";
  return "other";
}
export type LeadFacts = Record<string, string | number | boolean | null>;
export function supportFacts(row: LeadBoard["support"][number], config: LeadRuleConfig): LeadFacts {
  const cluster = supportCluster(row.stage, row.detail);
  return {
    cluster, sinceContact: row.sinceContact, neverContacted: row.sinceContact === null, attempts7d: row.attempts7d,
    cadenceOver: row.sinceContact === null ? null : row.sinceContact - (config.cadence[cluster] ?? 30),
    lastResult: row.lastResult || "none", summaryLength: row.summaryLength, hasNext: row.nextDueInDays !== null,
    nextOverdue: row.nextDueInDays !== null && row.nextDueInDays < 0, paused: PAUSED_DETAILS.has(row.detail ?? ""),
  };
}
export function teachFacts(row: LeadBoard["teach"][number], config: LeadRuleConfig): LeadFacts {
  const label = row.label ?? "none";
  return { label, learningLogged: row.learningLogged, hoursSinceLesson: row.hoursSinceLesson, sinceContact: row.sinceContact,
    contactedEver: row.contactedEver, contactOver: row.sinceContact - (config.cadence[label] ?? config.cadence.contact ?? 30) };
}
export function assessFacts(row: LeadBoard["assess"][number]): LeadFacts {
  return { step: row.step, hoursOver: row.hoursOver };
}

function test([field, op, value]: LeadCondition, facts: LeadFacts) {
  const actual = facts[field];
  if (actual === null || actual === undefined) return false;
  switch (op) {
    case "is": case "in": case "=": return actual === value;
    case "notin": return actual !== value;
    case ">": return typeof actual === "number" && actual > Number(value);
    case ">=": return typeof actual === "number" && actual >= Number(value);
    case "<": return typeof actual === "number" && actual < Number(value);
    case "<=": return typeof actual === "number" && actual <= Number(value);
  }
}
/** 自上而下，第一条全部条件成立的规则决定灯色。 */
export function judgeLead(config: LeadRuleConfig, facts: LeadFacts): { color: LeadLight; rule: number } {
  const index = config.rules.findIndex(rule => rule.all.every(condition => test(condition, facts)));
  return index < 0 ? { color: config.else, rule: -1 } : { color: config.rules[index].color, rule: index };
}
