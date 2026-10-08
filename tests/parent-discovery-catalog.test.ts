import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { portalGet } from "@/features/parent-portal/server";
import type { Activity as ParticipantActivity } from "../contracts/participant-api/portal";
import type { Activity } from "../contracts/parent-api/portal";

const state = vi.hoisted(() => ({ rpc: vi.fn(), admin: vi.fn(), filters: [] as unknown[][] }));
vi.mock("server-only", () => ({}));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc: state.rpc }) }));
vi.mock("@/lib/supabase/config", () => ({ getSupabaseConfig: () => ({ url: "https://example.invalid", key: "public-placeholder" }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: state.admin }));

const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];
const now = Date.parse("2026-10-05T00:00:00Z");
const activity = (id: string, patch: Partial<Activity> = {}): Activity => ({ id,
  title: { zh: "数学活动", en: "Math activity" }, description: { zh: "观察与推理", en: "Observe and reason" },
  location: "开发场地", startsAt: "2026-10-06T06:00:00Z", durationMinutes: 60, remaining: 4, bookable: true, ...patch });
const participantActivity = (id: string, patch: Partial<ParticipantActivity> = {}): ParticipantActivity => ({ ...activity(id), ...patch });
const request = () => new Request("https://example.invalid/api/v1/parent/portal?resource=activities");

beforeEach(() => { vi.resetAllMocks(); state.filters = []; });

describe("发现页公开目录", () => {
  it("只补充公开列表内的项目，限定读取字段和当前记录", async () => {
    const rows = ids.slice(0, 2).map(id => activity(id));
    state.rpc.mockResolvedValue({ data: rows, error: null });
    const query = {
      select: (columns: string) => { state.filters.push(["select", columns]); return query; },
      in: (key: string, values: string[]) => { state.filters.push(["in", key, values]); return query; },
      is: (key: string, value: unknown) => { state.filters.push(["is", key, value]); return query; },
      eq: async (key: string, value: unknown) => {
        state.filters.push(["eq", key, value]);
        return { data: ids.map((id, index) => ({ id, target_grades: index ? null : [6], kind: index ? "other" : "public_class" })), error: null };
      },
    };
    const from = vi.fn().mockReturnValue(query);
    state.admin.mockReturnValue({ from });
    const response = await portalGet(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      { ...rows[0], targetGrades: [6], subject: "math" }, { ...rows[1], targetGrades: null, subject: null },
    ]);
    expect(state.rpc).toHaveBeenCalledWith("miniapp_public_activities");
    expect(from).toHaveBeenCalledWith("activities");
    expect(state.filters).toEqual([["select", "id,target_grades,kind"], ["in", "id", ids.slice(0, 2)], ["is", "deleted_at", null], ["eq", "record_state", "current"]]);
  });

  it("空公开目录直接返回，不读取管理员资源", async () => {
    state.rpc.mockResolvedValue({ data: [], error: null });
    expect(await (await portalGet(request())).json()).toEqual([]);
    expect(state.admin).not.toHaveBeenCalled();
  });

  it("阶段和科目取自分类字段，区分不限年级和待核对并排除过期项目", () => {
    const compiled = ts.transpileModule(readFileSync("apps/parent-wechat/miniprogram/lib/catalog.ts", "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 },
    });
    const exports: { filterCatalog?: (rows: ParticipantActivity[], stage: string, topic: string, now: number) => ParticipantActivity[] } = {};
    vm.runInNewContext(compiled.outputText, { exports, Date });
    const rows = [
      participantActivity("unknown", { targetStages: null, topic: "math" }),
      participantActivity("all", { targetStages: [], topic: "math" }),
      participantActivity("six", { targetStages: [6], topic: "math" }),
      participantActivity("seven", { targetStages: [7], topic: "math" }),
      participantActivity("unclassified", { targetStages: [6], topic: null }),
      participantActivity("past", { targetStages: [6], topic: "math", startsAt: "2026-10-04T00:00:00Z" }),
    ];
    expect(exports.filterCatalog!(rows, "g6", "math", now).map(row => row.id)).toEqual(["all", "six"]);
    expect(exports.filterCatalog!(rows, "k2", "math", now).map(row => row.id)).toEqual(["all"]);
    expect(exports.filterCatalog!(rows, "", "", now)).toHaveLength(5);
  });
});
