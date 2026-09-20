import fs from "node:fs";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createTranslator } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import zh from "../messages/zh.json";
import en from "../messages/en.json";
import { openHistoryLocalTarget } from "../scripts/lib/history-local-target.mjs";
import { loadFixedAccount } from "../e2e/support/fixed-accounts";
import { listAssessmentWorkbenchRows } from "@/features/school/assessment-workbench-data";
import { loadAssessmentWorkbenchPage } from "@/features/school/assessment-list-data";
import { assessmentTableFields } from "@/features/school/assessment-table-fields";
import { assessmentPageStage, assessmentWorkbenchFieldPage, type AssessmentPageQuery } from "@/features/school/assessment-workbench-page";

const state = vi.hoisted(() => ({ client: null as unknown as ReturnType<typeof createClient> }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.client }));
const digest = (data: unknown) => createHash("sha256").update(JSON.stringify(data) ?? "undefined").digest("hex");
const comparable = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(comparable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, item]) => item != null)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, comparable(item)]));
  return value;
};

describe.skipIf(process.env.MATHIN_TABLE_PAGE_DB_TEST !== "1")("database assessment pages against the complete authorized reader", () => {
  it("preserves scope, all column filters, facets, ordering and subject details with bounded list reads", async () => {
    const folder = ".tmp/table-page-optimization";
    fs.mkdirSync(folder, { recursive: true });
    openHistoryLocalTarget({ attestationPath: `${folder}/target.json`, refresh: true, errorFile: `${folder}/target-error.txt` });
    const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter(line => /^[A-Z_]+=/.test(line))
      .map(line => { const i = line.indexOf("="); return [line.slice(0, i), line.slice(i + 1).replace(/^['"]|['"]$/g, "")]; }));
    const report: unknown[] = [];
    for (const role of ["admin", "teacher", "research", "student"] as const) {
      let requests = 0, bytes = 0;
      state.client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (input, init) => {
          const response = await fetch(input, init);
          if (String(input).includes("/rest/v1/")) { requests++; bytes += Buffer.byteLength(await response.clone().text()); }
          return response;
        } },
      });
      const credentials = loadFixedAccount(role);
      if (!credentials) throw new Error("FIXED_ACCOUNT_REQUIRED");
      const login = await state.client.auth.signInWithPassword(credentials);
      if (login.error) throw new Error("FIXED_LOGIN_FAILED");
      try {
        const rpc = (state.client.rpc as unknown as (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>).bind(state.client);
        const perms = await Promise.all(["review.write", "followup.view"].map(p_key => rpc("has_perm", { uid: login.data.user!.id, p_key })));
        expect(perms.every(result => !result.error)).toBe(true);
        // 无权限角色必须由 RPC 拒绝，不能依赖页面隐藏。
        if (role === "student" || perms.every(result => result.data === false)) {
          const denied = await rpc("list_assessment_workbench_page", { p_state: "all", p_search: "", p_page: 1, p_page_size: 50,
            p_query: { version: 2, filters: {}, sort: null }, p_locale: "zh", p_labels: {} });
          expect(denied.error?.message).toBe("FORBIDDEN"); report.push({ role, denied: true }); continue;
        }
        const baseline = await listAssessmentWorkbenchRows();
        // 全部列表 DTO 与原读取器对照，避免可见列相同但编辑上下文发生偏差。
        const summaries = await rpc("assessment_list_rows", { p_state: "all" });
        expect(summaries.error).toBeNull();
        for (const item of summaries.data as { payload: (typeof baseline)[number] }[]) {
          const expected = baseline.find(row => row.id === item.payload.id);
          expect(Boolean(expected), `${role}/summary identity`).toBe(true);
          const omit = new Set(["listSummary", "entryActors", "sourceCompletion"]);
          const changed = Object.keys(item.payload).filter(key => !omit.has(key)).filter(key => {
            const project = (row: (typeof baseline)[number]) => {
              const value = row[key as keyof typeof row];
              if (key === "questionSummary" && value) {
                return Object.fromEntries(Object.entries(value).filter(([field]) => field !== "outcomeCounts" && field !== "keyNotes"));
              }
              return value;
            };
            return digest(comparable(project(item.payload))) !== digest(comparable(project(expected!)));
          });
          expect(changed, `${role}/summary fields`).toEqual([]);
        }
        for (const locale of ["zh", "en"] as const) {
          const messages = locale === "zh" ? zh : en;
          const t = (namespace: "school.table" | "school.assessments" | "school.supportAssessment" | "school.teacherAssessment" | "school.assessmentQuickEntry") => {
            const translate = createTranslator({ locale, messages, namespace });
            return (key: string, values?: Record<string, string | number>) => translate(key as Parameters<typeof translate>[0], values);
          };
          const fields = assessmentTableFields({ locale, timeZone: "Asia/Shanghai", tableT: t("school.table"), assessmentT: t("school.assessments"),
            t: t("school.supportAssessment"), teacherT: t("school.teacherAssessment"), quickT: t("school.assessmentQuickEntry"), stageFor: assessmentPageStage });
          const context = { locale, timeZone: "Asia/Shanghai", now: Date.now() };
          const fieldValue = (row: (typeof baseline)[number], id: string) => {
            const field = fields[id]; return field.kind === "enum" ? field.values(row) : field.value(row);
          };
          const cases: [string, AssessmentPageQuery][] = [["first", {}], ["page2", { page: "2" }], ["last", { state: "all", page: "99999" }],
            ["empty", { q: "__absent_assessment_probe__" }], ["history", { state: "historical" }]];
          const allPage = assessmentWorkbenchFieldPage(baseline, fields, { state: "all" }, context);
          for (const [id, field] of Object.entries(process.env.MATHIN_TABLE_PAGE_DB_QUICK === "1" ? {} : fields)) {
            const facet = allPage.fieldView.facets[id];
            const filter = field.kind === "enum" && facet.options[0] ? { kind: "enum", values: [facet.options[0].value] }
              : field.kind === "date" && facet.days[0] ? { kind: "date", from: facet.days.at(-1), to: facet.days[0] }
                : field.kind === "number" ? { kind: "number", min: 0, max: 100 } : { kind: "presence", value: "missing" };
            cases.push([`filter_${id}`, { state: "all", fields: JSON.stringify({ version: 2, filters: { [id]: filter }, sort: null }) }]);
            if (field.sortable !== false) cases.push([`sort_${id}`, { state: "all", fields: JSON.stringify({ version: 2, filters: {}, sort: { field: id, direction: "asc" } }) }]);
          }
          if (baseline.length) cases.push(["search", { state: "all", q: baseline[0].name.slice(0, 1) }]);
          for (const [name, raw] of cases) {
            fs.writeFileSync(`${folder}/assessment-progress.json`, JSON.stringify({ role, locale, name, completed: report }, null, 2));
            const expected = assessmentWorkbenchFieldPage(baseline, fields, raw, context);
            requests = 0; bytes = 0; const start = performance.now();
            const actual = await loadAssessmentWorkbenchPage(fields, raw, context);
            const equalRows = digest(actual.rows.map(row => row.id)) === digest(expected.rows.map(row => row.id));
            const changedFields = Object.keys(fields).filter(id => digest(actual.rows.map(row => fieldValue(row, id))) !== digest(expected.rows.map(row => fieldValue(row, id))));
            const changedFacets = Object.keys(fields).filter(id => digest(actual.fieldView.facets[id]) !== digest(expected.fieldView.facets[id]));
            // 错误只报告字段名，避免失败输出含学生姓名、电话或业务行。
            expect({ equalRows, changedFields, changedFacets, count: actual.count, page: actual.page }, `${role}/${locale}/${name}`)
              .toEqual({ equalRows: true, changedFields: [], changedFacets: [], count: expected.count, page: expected.page });
            expect(requests).toBe(1); expect(actual.rows.length).toBeLessThanOrEqual(actual.pageSize);
            if (name === "empty") expect(bytes).toBeLessThan(4000);
            if (locale === "zh" && ["first", "page2", "last", "empty", "history"].includes(name)) report.push({ role, name, ms: Math.round(performance.now() - start), requests, bytes, rows: actual.rows.length, count: actual.count });
          }
        }
        for (const row of baseline.filter(row => row.studentId || row.leadId).slice(0, 3)) {
          const details = await listAssessmentWorkbenchRows({ studentId: row.studentId, leadId: row.leadId });
          if (!details.some(detail => detail.id === row.id)) console.log({ detailMissing: true, kind: row.id.split(":")[0], student: Boolean(row.studentId), lead: Boolean(row.leadId), rows: details.length });
          expect(digest(details.find(detail => detail.id === row.id)), `${role}/subject detail`).toBe(digest(row));
        }
      } finally { await state.client.auth.signOut({ scope: "local" }); }
    }
    fs.writeFileSync(`${folder}/assessment-results.json`, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  }, 180000);
});
