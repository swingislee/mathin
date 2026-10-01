import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import type { Activity, Booking, ParentLearning } from "../contracts/parent-api/portal";
import type { ActivityFilter } from "../apps/parent-wechat/miniprogram/lib/discovery";

const miniRoot = path.resolve("apps/parent-wechat/miniprogram");
type RuntimePage = {
  data: Record<string, unknown> & {
    step: number; booked: boolean; uncertain: boolean; participants: { id: string; name: string }[];
    events: { key: string; title: string }[]; dayEvents: { title: string }[]; learning: ParentLearning | null;
    daySessions: { title: string; participantId: string }[];
  };
  setData: (value: Record<string, unknown>) => void;
  book: () => Promise<void>; review: () => void; back: () => void; loadMonth: () => Promise<void>;
  signIn: () => Promise<void>; load: () => Promise<void>; participant: (event: { detail: { value: string } }) => void;
  onShow: () => void; onHide: () => void; updateSelection: () => void;
  selectActivity: (activity: Activity) => void; startAgain: () => void; loadWeek: () => Promise<void>;
  location: (event: { currentTarget: { dataset: { value: string } } }) => void;
  chooseSlot: (event: { currentTarget: { dataset: { id: string } } }) => void;
  chooseParticipant: (event: { currentTarget: { dataset: { index: number } } }) => void;
};
type DiscoveryModule = {
  canReserve: (activity: Activity) => boolean; canCancel: (booking: Booking, now: number) => boolean;
  filterActivities: (rows: Activity[], filter: ActivityFilter, locale: "zh" | "en", now: number) => Activity[];
  calendarDays: (month: string, events: string[], selected: string, now: Date) => { date: string; day: string; count: number; selected: boolean; today: boolean }[];
  shiftMonth: (month: string, offset: number) => string; monthRange: (month: string) => { from: string; to: string };
  weekRange: (date: string) => { from: string; to: string };
  weekDays: (date: string, events: string[], now: Date) => { date: string; count: number; selected: boolean }[];
};
type NavigationModule = {
  rememberReturn: (url: string) => void; resumeAfterLogin: () => void; clearNavigation: () => void;
  selectParticipant: (id: string) => void; selectedParticipant: () => string;
  openPage: (url: string) => void;
};
function runtime(api: Record<string, unknown> = {}, language = "zh_CN") {
  let page: RuntimePage;
  const wx = {
    getAppBaseInfo: () => ({ language }), setNavigationBarTitle: vi.fn(), setTabBarItem: vi.fn(),
    switchTab: vi.fn(), navigateTo: vi.fn(), showToast: vi.fn(),
    showModal: vi.fn((options: { success?: (value: { confirm: boolean }) => void }) => options.success?.({ confirm: true })),
  };
  const cache = new Map<string, Record<string, unknown>>();
  const apiModule = { ApiError: class extends Error { constructor(public code: string) { super(code); } }, session: () => ({}), ...api };
  function load(relative: "lib/discovery.ts"): DiscoveryModule;
  function load(relative: "lib/navigation.ts"): NavigationModule;
  function load(relative: string): Record<string, unknown>;
  function load(relative: string): Record<string, unknown> {
    const file = path.resolve(miniRoot, relative);
    if (file === path.join(miniRoot, "lib/api.ts")) return apiModule;
    if (cache.has(file)) return cache.get(file)!;
    const exports: Record<string, unknown> = {};
    cache.set(file, exports);
    const compiled = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 } });
    vm.runInNewContext(compiled.outputText, {
      exports, wx, Date, console,
      require: (name: string) => load(path.relative(miniRoot, path.resolve(path.dirname(file), name + ".ts"))),
      Page: (options: RuntimePage) => {
        page = options;
        page.setData = patch => {
          for (const [key, value] of Object.entries(patch)) {
            const parts = key.replace(/\[(\d+)\]/g, ".$1").split(".");
            let object: Record<string, unknown> = page.data;
            for (const part of parts.slice(0, -1)) object = object[part] as Record<string, unknown>;
            object[parts[parts.length - 1]] = value;
          }
        };
      },
    });
    return exports;
  }
  return { wx, load, page: () => page! };
}
const now = new Date(2026, 9, 1, 10).getTime();
const timestamp = (day: number, hour = 14) => new Date(2026, 9, day, hour).toISOString();
const activity = (id: string, patch: Partial<Activity> = {}): Activity => ({ id,
  title: { zh: "观察活动", en: "Observation walk" }, description: { zh: "一起观察", en: "Observe together" },
  location: "North", startsAt: timestamp(3), durationMinutes: 60, remaining: 3, bookable: true, ...patch });
const booking = (id: string, patch: Partial<Booking> = {}): Booking => ({ id, activityId: "event", participantId: "member-a",
  participantName: "Member", title: { zh: "活动", en: "Activity" }, startsAt: timestamp(3), location: "North", status: "booked", ...patch });
const learning = (id: string, title = id): ParentLearning => ({ participantId: id, generatedAt: timestamp(1), range: { from: timestamp(1), to: timestamp(30) },
  summary: null, courses: [], schedule: [{ id: "session-" + id, participantId: id, classroomId: "group", classroomName: title,
    title, startsAt: timestamp(3), durationMinutes: 60, teacherName: null }], attendance: [], notifications: [], leaveRequests: [], reports: [], unassignedReportCount: 0,
  capabilities: { leaveRequests: false, notificationRead: false, chat: false, rescheduling: false, wrongAnswers: false, profileEditing: false, payments: false } });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

describe("小程序发现与参与合同", () => {
  it("在已返回活动中组合语言、地点、日期与名额筛选，保持实际标题", () => {
    const { load } = runtime();
    const { filterActivities, canReserve } = load("lib/discovery.ts");
    const rows = [activity("open"), activity("full", { remaining: 0 }), activity("closed", { bookable: false }),
      activity("later", { startsAt: timestamp(20) }), activity("other", { location: "South" }), activity("past", { startsAt: timestamp(1, 9) })];
    const matches = filterActivities(rows, { search: "walk", location: "North", period: "week", availableOnly: true }, "en", now);
    expect(matches.map((row: Activity) => row.id)).toEqual(["open"]);
    expect(matches[0].title.zh).toBe("观察活动");
    expect(canReserve(activity("unlimited", { remaining: null }))).toBe(true);
    expect(canReserve(activity("full", { remaining: 0 }))).toBe(false);
  });

  it("取消按钮只对尚未开始的有效预约开放", () => {
    const { canCancel } = runtime().load("lib/discovery.ts");
    expect(canCancel(booking("active"), now)).toBe(true);
    expect(canCancel(booking("past", { startsAt: timestamp(1, 9) }), now)).toBe(false);
    expect(canCancel(booking("cancelled", { status: "cancelled" }), now)).toBe(false);
    expect(canCancel(booking("attended", { status: "attended" }), now)).toBe(false);
  });

  it("月历以周一开头，正确处理闰年、跨年与选中日期", () => {
    const { calendarDays, shiftMonth, monthRange } = runtime().load("lib/discovery.ts");
    const days = calendarDays("2024-02", [new Date(2024, 1, 29, 9).toISOString()], "2024-02-29", new Date(2024, 1, 29));
    expect(days.slice(0, 3).every((day: { date: string }) => !day.date)).toBe(true);
    expect(days.find((day: { date: string }) => day.date === "2024-02-29")).toMatchObject({ day: "29", count: 1, selected: true, today: true });
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(new Date(monthRange("2026-12").to).getFullYear()).toBe(2027);
  });

  it("本周课程覆盖跨月的周一至周日", () => {
    const { weekRange, weekDays } = runtime().load("lib/discovery.ts");
    const range = weekRange("2026-10-01");
    const days = weekDays("2026-10-01", [timestamp(3)], new Date(2026, 9, 1));
    expect(new Date(range.from).getDay()).toBe(1);
    expect(new Date(range.to).getDay()).toBe(1);
    expect(days.map(day => day.date)).toEqual(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
    expect(days.find(day => day.date === "2026-10-03")?.count).toBe(1);
    expect(days.filter(day => day.selected).map(day => day.date)).toEqual(["2026-10-01"]);
  });

  it("登录后返回原活动一次，清除账号时也清除成员选择和返回意图", () => {
    const run = runtime();
    const navigation = run.load("lib/navigation.ts");
    navigation.rememberReturn("/pages/activity/index?id=event");
    navigation.resumeAfterLogin(); navigation.resumeAfterLogin();
    expect(run.wx.navigateTo).toHaveBeenCalledExactlyOnceWith({ url: "/pages/activity/index?id=event" });
    navigation.rememberReturn("/pages/agenda/index"); navigation.selectParticipant("member-a"); navigation.clearNavigation(); navigation.resumeAfterLogin();
    expect(navigation.selectedParticipant()).toBe("");
    expect(run.wx.switchTab).not.toHaveBeenCalled();
    navigation.rememberReturn("https://external.invalid"); navigation.resumeAfterLogin();
    expect(run.wx.navigateTo).toHaveBeenCalledTimes(1);
  });

  it("三栏页面使用系统页签，预约与月课表保留二级返回路径", () => {
    const run = runtime();
    const navigation = run.load("lib/navigation.ts");
    navigation.openPage("/pages/courses/index");
    navigation.openPage("/pages/reservations/index?filter=cancelled");
    navigation.rememberReturn("/pages/agenda/index"); navigation.resumeAfterLogin();
    expect(run.wx.switchTab).toHaveBeenCalledExactlyOnceWith({ url: "/pages/courses/index" });
    expect(run.wx.navigateTo.mock.calls).toEqual([[{ url: "/pages/reservations/index?filter=cancelled" }], [{ url: "/pages/agenda/index" }]]);
  });

  it("预约需显式选择真实时段并确认，重复点击只提交一次", async () => {
    const pending = deferred<{ id: string }>();
    const post = vi.fn(() => pending.promise);
    const run = runtime({ post }); run.load("pages/activity/index.ts");
    const page = run.page();
    page.setData({ loaded: true, source: [activity("event")], participants: [{ id: "member-a", name: "A" }] });
    page.selectActivity(activity("event"));
    await page.book(); expect(post).not.toHaveBeenCalled();
    page.review(); expect(page.data.step).toBe(2);
    await page.book(); expect(post).not.toHaveBeenCalled();
    page.chooseSlot({ currentTarget: { dataset: { id: "event" } } });
    const first = page.book(); await page.book(); expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith({ action: "book", activityId: "event", participantId: "member-a" });
    page.onHide(); page.onShow();
    expect(page.data.participants[0].id).toBe("member-a");
    expect(page.data.loaded).toBe(true);
    pending.resolve({ id: "booking" }); await first;
    expect(page.data.booked).toBe(true);
    expect(page.data.reservationConfirmed).toBe(true);
    page.startAgain(); expect(page.data.booked).toBe(true);
    expect(page.data.reservationConfirmed).toBe(false);
    expect(page.data.step).toBe(1);
    page.setData({ booked: false, source: [activity("event", { remaining: 0 })], activity: activity("event", { remaining: 0 }) });
    page.review(); expect(page.data.step).toBe(1);
  });

  it("满额场次仍可进入同组其他地点，并提交所选场次 ID", async () => {
    const post = vi.fn().mockResolvedValue({ id: "booking" });
    const run = runtime({ post }); run.load("pages/activity/index.ts"); const page = run.page();
    const full = activity("full", { remaining: 0 });
    const available = activity("south", { location: "South" });
    page.setData({ loaded: true, source: [full, available], participants: [{ id: "member-a", name: "Same" }, { id: "member-b", name: "Same" }] });
    page.selectActivity(full); page.review(); expect(page.data.step).toBe(2);
    page.chooseSlot({ currentTarget: { dataset: { id: "full" } } });
    expect(page.data.selectedSlot).toBe("");
    page.location({ currentTarget: { dataset: { value: "South" } } });
    page.chooseSlot({ currentTarget: { dataset: { id: "south" } } });
    await page.book();
    expect(post).toHaveBeenCalledExactlyOnceWith({ action: "book", activityId: "south", participantId: "member-a" });
    page.startAgain(); page.review(); expect(page.data.step).toBe(1);
    page.chooseParticipant({ currentTarget: { dataset: { index: 1 } } }); page.review();
    expect(page.data.step).toBe(2);
    expect(page.data.booked).toBe(false);
    page.chooseSlot({ currentTarget: { dataset: { id: "south" } } });
    await page.book();
    expect(post).toHaveBeenLastCalledWith({ action: "book", activityId: "south", participantId: "member-b" });
  });

  it("预约结果不明时引导查记录，页面不会直接再次提交", async () => {
    const post = vi.fn().mockRejectedValue(new Error("connection lost"));
    const run = runtime({ post }); run.load("pages/activity/index.ts"); const page = run.page();
    page.setData({ loaded: true, id: "event", selectedSlot: "event", step: 2, activity: activity("event"), participants: [{ id: "member-a", name: "A" }] });
    await page.book(); await page.book();
    expect(page.data.uncertain).toBe(true); expect(post).toHaveBeenCalledTimes(1);
    const error = page.data.error;
    page.back(); page.review();
    expect(page.data.error).toBe(error);
    expect(page.data.uncertain).toBe(true);
  });

  it("同一活动按参与人判断已有预约，切换成员可继续预约", () => {
    const run = runtime(); run.load("pages/activity/index.ts"); const page = run.page();
    page.setData({ id: "event", participants: [{ id: "member-a", name: "Same" }, { id: "member-b", name: "Same" }],
      bookings: [booking("a")], selected: 0 });
    page.updateSelection(); expect(page.data.booked).toBe(true);
    page.setData({ selected: 1 }); page.updateSelection(); expect(page.data.booked).toBe(false);
  });

  it("账号读取首次失败，重试成功后仍返回原活动", async () => {
    const get = vi.fn().mockRejectedValueOnce(new Error("connection lost")).mockResolvedValue({ id: "account", displayName: "Member", participants: [] });
    const run = runtime({ login: vi.fn().mockResolvedValue(undefined), get });
    run.load("lib/navigation.ts").rememberReturn("/pages/activity/index?id=event");
    run.load("pages/account/index.ts"); const page = run.page();
    page.setData({ identifier: "test", password: "test" });
    await page.signIn(); expect(run.wx.navigateTo).not.toHaveBeenCalled();
    await page.load(); expect(run.wx.navigateTo).toHaveBeenCalledExactlyOnceWith({ url: "/pages/activity/index?id=event" });
  });

  it("刷新时成员顺序改变，预约筛选仍保持同一 ID", async () => {
    let participants = [{ id: "member-a", name: "Same" }, { id: "member-b", name: "Same" }];
    const run = runtime({ get: vi.fn(async (resource: string) => resource === "account"
      ? { id: "account", displayName: "Member", participants }
      : [booking("a"), booking("b", { participantId: "member-b" })]) });
    run.load("pages/reservations/index.ts"); const page = run.page();
    await page.load(); page.participant({ detail: { value: "1" } });
    participants = [...participants].reverse(); await page.load();
    expect(page.data.participantId).toBe("member-a"); expect(page.data.participantIndex).toBe(2);
  });

  it("切换同名成员后丢弃旧响应，预约和课表都按稳定 ID 过滤", async () => {
    const slow = deferred<ParentLearning>();
    const run = runtime({ learning: vi.fn((id: string) => id === "member-a" ? slow.promise : Promise.resolve(learning(id, "B schedule"))),
      get: vi.fn().mockResolvedValue([booking("a"), booking("b", { participantId: "member-b" })]) });
    run.load("pages/agenda/index.ts"); const page = run.page();
    page.setData({ participants: [{ id: "member-a", name: "Same" }, { id: "member-b", name: "Same" }], month: "2026-10", selectedDate: "2026-10-03" });
    const old = page.loadMonth();
    page.setData({ selected: 1 }); await page.loadMonth();
    expect(page.data.events.map((row: { key: string }) => row.key).sort()).toEqual(["activity-b", "session-session-member-b"]);
    slow.resolve(learning("member-a", "A schedule")); await old;
    expect(page.data.learning?.participantId).toBe("member-b");
    expect(page.data.dayEvents.map((row: { title: string }) => row.title)).toContain("B schedule");
  });

  it("快速换月不会被前一个月份的延迟返回覆盖", async () => {
    const slow = deferred<ParentLearning>();
    const request = vi.fn().mockImplementationOnce(() => slow.promise).mockResolvedValue(learning("member-a", "New month"));
    const run = runtime({ learning: request, get: vi.fn().mockResolvedValue([]) });
    run.load("pages/agenda/index.ts"); const page = run.page();
    page.setData({ participants: [{ id: "member-a", name: "A" }], month: "2026-09" });
    const old = page.loadMonth(); page.setData({ month: "2026-10" }); await page.loadMonth();
    slow.resolve(learning("member-a", "Old month")); await old;
    expect(page.data.learning?.schedule[0].title).toBe("New month");
  });

  it("周课表切换同名孩子后，保留新孩子的课次并丢弃旧响应", async () => {
    const slow = deferred<ParentLearning>();
    const request = vi.fn((id: string) => id === "member-a" ? slow.promise : Promise.resolve({ ...learning(id, "B schedule"),
      schedule: [...learning(id, "B schedule").schedule, ...learning("other", "Other schedule").schedule] }));
    const run = runtime({ learning: request }); run.load("pages/courses/index.ts"); const page = run.page();
    page.setData({ participants: [{ id: "member-a", name: "Same" }, { id: "member-b", name: "Same" }], selectedDate: "2026-10-03" });
    const old = page.loadWeek();
    page.setData({ selected: 1 }); await page.loadWeek();
    slow.resolve(learning("member-a", "A schedule")); await old;
    expect(page.data.daySessions.map(row => row.title)).toEqual(["B schedule"]);
    expect(page.data.daySessions[0].participantId).toBe("member-b");
  });
});
