import { describe, expect, it } from "vitest";
import { RequestCookies } from "next/dist/compiled/@edge-runtime/cookies";
import { STAFF_OVERVIEW_METRICS } from "@/features/school/home/staff-overview-contract";
import { encodeOverviewDisplaySelection, readOverviewDisplaySelection, saveOverviewDisplayCookies, selectOverviewDisplayIds, selectOverviewSupportRows, selectOverviewTeacherRows, staffOverviewDisplayCookie, staffOverviewSupportCookie } from "@/features/school/home/staff-overview-display-contract";
import type { StaffOverviewSupportFunnelRow } from "@/features/school/home/staff-overview-data";

const row = (id: string | null, value: number): StaffOverviewSupportFunnelRow => ({
  key: id ?? "__unassigned__", userId: id, name: id ?? "",
  metrics: Object.fromEntries(STAFF_OVERVIEW_METRICS.map(metric => [metric, { current: value, previous: value + 1 }])) as StaffOverviewSupportFunnelRow["metrics"],
});

it("keeps remembered alias selections on the canonical account", () => {
  const oldId=`source-staff:${encodeURIComponent("旧称")}`;
  const options=[{userId:"existing-account",name:"默认姓名",aliasIds:[oldId]}, {userId:"existing-account",name:"默认姓名"}];
  expect(selectOverviewDisplayIds(options,[],JSON.stringify([oldId,"existing-account"])).selectedIds).toEqual(["existing-account"]);
});

describe("overview staff display", () => {
  const rows = [row("a", 2), row("b", 4), row(null, 3)];
  const directory = [{ userId: "a", name: "A" }, { userId: "b", name: "B" }, { userId: "c", name: "C" }];
  it("keeps organization totals and unassigned records when choosing staff", () => {
    const selected = selectOverviewSupportRows(rows, directory, "a,c");
    expect(selected.rows.map(row => row.key)).toEqual(["a", "c", "__other__", "__unassigned__"]);
    for (const metric of STAFF_OVERVIEW_METRICS) {
      for (const period of ["current", "previous"] as const) {
        expect(selected.rows.reduce((sum, row) => sum + row.metrics[metric][period]!, 0))
          .toBe(rows.reduce((sum, row) => sum + row.metrics[metric][period]!, 0));
      }
    }
  });
  it("keeps explicit empty selections and removes unavailable options without resetting the rest", () => {
    expect(selectOverviewSupportRows(rows, directory, "none").rows.map(row => row.key)).toEqual(["__other__", "__unassigned__"]);
    expect(selectOverviewSupportRows(rows, directory, "a,unknown").selectedIds).toEqual(["a"]);
    expect(selectOverviewSupportRows(rows, directory, "unknown").selectedIds).toEqual([]);
    expect(selectOverviewSupportRows(rows, directory).rows).toEqual(rows);
  });
  it("preserves unavailable values instead of showing false zeroes", () => {
    const incomplete = row("b", 0);
    incomplete.metrics.contacts.current = null;
    const selected = selectOverviewSupportRows([rows[0], incomplete], directory, "a,c");
    expect(selected.rows.find(row => row.key === "__other__")!.metrics.contacts.current).toBeNull();
    expect(selected.rows.find(row => row.key === "c")!.metrics.contacts.current).toBeNull();
  });
  it("keeps display preferences separate between signed-in accounts", () => {
    expect(staffOverviewSupportCookie("a")).not.toBe(staffOverviewSupportCookie("b"));
  });
});

function browserCookies(blockedName?: string) {
  const jar = new Map<string, string>();
  return {
    get cookie() { return Array.from(jar, ([name, value]) => `${name}=${value}`).join("; "); },
    set cookie(value: string) {
      const [pair] = value.split(";");
      const name = pair.slice(0, pair.indexOf("="));
      if (name === blockedName) return;
      if (value.includes("Max-Age=0")) jar.delete(name);
      else jar.set(name, pair.slice(name.length + 1));
    },
  };
}

describe("overview display persistence", () => {
  const sourceId = `source-staff:${encodeURIComponent("来源学服乙")}`;
  const options = [{ userId: "account-a", name: "老师甲" }, { userId: sourceId, name: "来源学服乙" }];
  it("survives the browser write and Next cookie decoding, including Chinese source signatures", () => {
    const store = browserCookies();
    const name = staffOverviewSupportCookie("account");
    expect(saveOverviewDisplayCookies([{ name, value: encodeOverviewDisplaySelection([sourceId], options) }], store)).toBe(true);
    const value = new RequestCookies(new Headers({ cookie: store.cookie })).get(name)?.value;
    expect(selectOverviewSupportRows([row(sourceId, 3), row("account-a", 2)], options, value).selectedIds).toEqual([sourceId]);
    // 旧版 Cookie 经框架解码后，也能恢复已经保存过的名单。
    const legacy = new RequestCookies(new Headers({ cookie: `${name}=${sourceId},account-a` })).get(name)?.value;
    expect(readOverviewDisplaySelection(legacy)).toEqual([sourceId, "account-a"]);
  });
  it("remembers separate selections for all panels, grades, and signed-in accounts", () => {
    const store = browserCookies();
    const scopes = ["support", "participation", "capacity_teachers", "capacity_grades"] as const;
    const writes = scopes.map((scope, index) => ({ name: staffOverviewDisplayCookie("account-a", scope), value: encodeOverviewDisplaySelection([String(index)], []) }));
    expect(new Set(writes.map(row => row.name)).size).toBe(4);
    expect(saveOverviewDisplayCookies(writes, store)).toBe(true);
    const cookies = new RequestCookies(new Headers({ cookie: store.cookie }));
    scopes.forEach((scope, index) => {
      expect(readOverviewDisplaySelection(cookies.get(staffOverviewDisplayCookie("account-a", scope))?.value)).toEqual([String(index)]);
      expect(cookies.get(staffOverviewDisplayCookie("account-b", scope))).toBeUndefined();
    });
    expect(saveOverviewDisplayCookies([{ name: writes[1].name, value: null }], store)).toBe(true);
    expect(new RequestCookies(new Headers({ cookie: store.cookie })).get(writes[0].name)?.value).toBe(cookies.get(writes[0].name)?.value);
    expect(new RequestCookies(new Headers({ cookie: store.cookie })).get(writes[1].name)).toBeUndefined();
  });
  it("keeps an empty selection, compactly saves all options, and handles malformed values", () => {
    expect(readOverviewDisplaySelection(encodeOverviewDisplaySelection([], options))).toEqual([]);
    expect(encodeOverviewDisplaySelection(options.map(row => row.userId), options)).toBe("all");
    expect(selectOverviewDisplayIds(options, [], "all").selectedIds).toHaveLength(2);
    expect(readOverviewDisplaySelection("[null]")).toBeUndefined();
    expect(readOverviewDisplaySelection("%5Bbroken")).toBeUndefined();
  });
  it("reports a blocked save and restores other settings from the same panel", () => {
    const store = browserCookies("blocked");
    expect(saveOverviewDisplayCookies([{ name: "teachers", value: "before" }], store)).toBe(true);
    expect(saveOverviewDisplayCookies([{ name: "teachers", value: "after" }, { name: "blocked", value: "grades" }], store)).toBe(false);
    expect(store.cookie).toBe("teachers=before");
  });
  it("keeps selected teachers with no period facts and preserves institution summary and unavailable values", () => {
    const summary = { participants: { current: 5, previous: 4 }, enrollments: { current: null, previous: 2 }, unattributedParticipants: { current: 1, previous: 0 } };
    const original = structuredClone(summary);
    const display = selectOverviewTeacherRows([{ userId: "teacher-a", name: "老师甲", participants: { current: 4, previous: 3 }, enrollments: { current: null, previous: 2 } }],
      [{ userId: "teacher-a", name: "老师甲" }, { userId: "teacher-b", name: "老师乙" }], summary, encodeOverviewDisplaySelection(["teacher-b"], []));
    expect(display.rows).toEqual([{ userId: "teacher-b", name: "老师乙", participants: { current: 0, previous: 0 }, enrollments: { current: null, previous: 0 } }]);
    expect(summary).toEqual(original);
  });
});
