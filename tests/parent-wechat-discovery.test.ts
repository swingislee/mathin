/// <reference path="../apps/parent-wechat/node_modules/miniprogram-api-typings/index.d.ts" />

import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Activity, ActivityOffer, Booking, ParticipantCalendar, AssessmentOverview, AssessmentRequest } from "../contracts/participant-api/portal";
import type { ActivityFilter } from "../apps/parent-wechat/miniprogram/lib/discovery";
import type * as AssessmentCalendar from "../apps/parent-wechat/miniprogram/lib/assessment-calendar";
import type * as AssessmentBooking from "../apps/parent-wechat/miniprogram/lib/assessment-booking";
import type { AssessmentAvailability } from "../contracts/participant-api/portal";
import { defaultMiniappSettings } from "../contracts/participant-api/miniapp-settings";
type PendingRequest = { id: string; facilitatorId: string; participantTimeOptions: string[] };
type AssessmentPending = {
  pendingAssessment: (account: string, participant: string) => PendingRequest | null;
  savePendingAssessment: (account: string, participant: string, value: PendingRequest) => void;
  clearPendingAssessment: (account: string, participant: string) => void;
};
type Touch = { currentTarget: { dataset: Record<string, string | number> } };

const miniRoot = path.resolve("apps/parent-wechat/miniprogram");
type RuntimePage = {
  data: Record<string, unknown> & {
    step: number; booked: boolean; uncertain: boolean; participants: { id: string; name: string }[];
    events: { key: string; title: string }[]; dayEvents: { title: string }[]; participantCalendar: ParticipantCalendar | null;
    daySessions: { title: string; participantId: string }[];
    requests: (AssessmentRequest & { confirmedTimeLabel: string; confirmOptions: { value: string }[] })[];
    overview: AssessmentOverview | null;
  };
  setData: (value: Record<string, unknown>) => void;
  book: () => Promise<void>; review: () => Promise<void>; back: () => void; loadMonth: () => Promise<void>;
  load: () => Promise<void>; participant: (event: { detail: { value: string } }) => void;
  onLoad: (query: Record<string, string>) => void; overviewSnapshot: AssessmentOverview | null; availabilitySnapshot: AssessmentAvailability | null;
  onShow: () => void; onHide: () => void; updateSelection: () => void;
  selectActivity: (activity: Activity) => void; startAgain: () => void; loadWeek: () => Promise<void>;
  location: (event: { currentTarget: { dataset: { value: string } } }) => void;
  chooseSlot: (event: { currentTarget: { dataset: { id: string } } }) => void;
  chooseParticipant: (event: { currentTarget: { dataset: { index: number } } }) => void;
  chooseActivity: (event: Touch) => void;
  openActivity: (event: { detail: { id: string } }) => void; chooseFacilitator: (event: Touch) => void; chooseTime: (event: { detail: { id: string } }) => void;
  submit: () => Promise<void>; retryPending: () => Promise<void>; loadParticipant: () => Promise<void>; startOver: () => void;
  renderRequests: () => void; selectConfirmation: (event: Touch) => void; confirm: (event: Touch) => Promise<void>;
  chooseCampus: (event: Touch) => void; chooseStage: (event: Touch) => void; chooseMode: (event: Touch) => void;
  showSheet: (event: Touch) => void; toggleTopic: (event: Touch) => void; confirmTopics: () => void;
  loadAvailability: () => Promise<void>;
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
  const storage = new Map<string, unknown>();
  const wx = {
    getAppBaseInfo: () => ({ language }), setNavigationBarTitle: vi.fn(), setTabBarItem: vi.fn(),
    switchTab: vi.fn(), navigateTo: vi.fn(), redirectTo: vi.fn(), showToast: vi.fn(),
    showModal: vi.fn(async (options: { success?: (value: { confirm: boolean }) => void }) => { options.success?.({ confirm: true }); return { confirm: true }; }),
    getStorageSync: (key: string) => storage.get(key),
    setStorageSync: (key: string, value: unknown) => storage.set(key, value),
    removeStorageSync: (key: string) => storage.delete(key),
  };
  const cache = new Map<string, Record<string, unknown>>();
  const apiModule = { ApiError: class extends Error { constructor(public code: string) { super(code); } }, session: () => ({}),
    miniappContentImage: () => "", miniappSettings: async () => ({ revision: 0, config: defaultMiniappSettings() }), ...api };
  function load(relative: "lib/discovery.ts"): DiscoveryModule;
  function load(relative: "lib/navigation.ts"): NavigationModule;
  function load(relative: "lib/assessment-calendar.ts"): typeof AssessmentCalendar;
  function load(relative: "lib/assessment-booking.ts"): typeof AssessmentBooking;
  function load(relative: "lib/assessment-pending.ts"): AssessmentPending;
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
const participantCalendar = (id: string, title = id): ParticipantCalendar => ({ participantId: id, generatedAt: timestamp(1), range: { from: timestamp(1), to: timestamp(30) },
  summary: null, groups: [], calendar: [{ id: "session-" + id, participantId: id, groupId: "group", groupName: title,
    title, startsAt: timestamp(3), durationMinutes: 60, facilitatorName: null }], attendance: [], notifications: [], leaveRequests: [], reports: [], unassignedReportCount: 0,
  capabilities: { leaveRequests: false, notificationRead: false, chat: false, rebooking: false, wrongAnswers: false, profileEditing: false, payments: false } });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const assessorId = "00000000-0000-4000-8000-000000000002";
const assessmentId = "00000000-0000-4000-8000-000000000001";
const assessmentTime = "2026-10-03@14:00";
const slotId = "00000000-0000-4000-8000-000000000004";
const campusId = "00000000-0000-4000-8000-000000000005";
const availability = (): AssessmentAvailability => ({ participantId: "member-a", timeZone: "Asia/Shanghai", from: "2026-10-01", to: "2026-10-14",
  facilitators: [{ id: assessorId, displayName: "Assessor" }], campuses: [{ id: campusId, name: "Campus" }],
  slots: [{ id: slotId, facilitatorId: assessorId, campusId, startsAt: "2026-10-03T06:00:00Z", endsAt: "2026-10-03T06:40:00Z", available: true }] });
const assessmentRequest = (patch: Partial<AssessmentRequest> = {}): AssessmentRequest => ({
  id: assessmentId, participantId: "member-a", facilitator: { id: assessorId, displayName: "Assessor" }, state: "awaiting_facilitator",
  participantTimeOptions: [assessmentTime], facilitatorTimeOptions: [], sharedTimeOptions: [], proposedStartsAt: null, confirmedStartsAt: null,
  updatedAt: timestamp(1), canConfirm: false, ...patch,
});
const assessmentOverview = (participantId = "member-a", requests: AssessmentRequest[] = []): AssessmentOverview => ({
  participantId, timeZone: "Asia/Shanghai", eligibility: { canRequest: true, reason: null },
  topics: [{ id: "math", label: { zh: "数学", en: "Math" }, available: true }, { id: "english", label: { zh: "英语", en: "English" }, available: true }],
  facilitators: [{ id: assessorId, displayName: "Assessor" }], requests,
});
const bookedAssessment = () => assessmentRequest({ state: "confirmed", participantTimeOptions: [], confirmedStartsAt: "2026-10-03T06:00:00Z",
  booking: { slotId, topics: ["math", "english"], stageNumber: 3, mode: "campus", campus: { id: campusId, name: "Campus" }, endsAt: "2026-10-03T06:40:00Z" } });
async function assessmentPage(postAssessment: ReturnType<typeof vi.fn>, overview = assessmentOverview()) {
  const getAssessments = vi.fn().mockResolvedValue(overview);
  const getAssessmentSlots = vi.fn().mockResolvedValue(availability());
  const run = runtime({ postAssessment, getAssessments, getAssessmentSlots, requestId: () => assessmentId,
    get: vi.fn().mockResolvedValue({ id: "account", participants: [{ id: "member-a", name: "A" }] }) });
  run.load("pages/assessment/index.ts"); const page = run.page();
  await page.load();
  page.showSheet({ currentTarget: { dataset: { sheet: "topic" } } });
  page.toggleTopic({ currentTarget: { dataset: { id: "math" } } });
  page.toggleTopic({ currentTarget: { dataset: { id: "english" } } }); page.confirmTopics();
  page.chooseStage({ currentTarget: { dataset: { stageNumber: 3 } } }); page.chooseMode({ currentTarget: { dataset: { id: "campus" } } });
  return { run, page, getAssessments, getAssessmentSlots };
}
async function selectAssessment(page: RuntimePage) {
  await page.review();
  page.chooseCampus({ currentTarget: { dataset: { id: campusId } } });
  page.chooseFacilitator({ currentTarget: { dataset: { id: assessorId } } });
  page.chooseTime({ detail: { id: slotId } });
}

describe("小程序发现与参与合同", () => {
  afterEach(() => vi.useRealTimers());
  it("时段表仅从真实发布记录生成，保留完整星期和起止时间并禁用已约格", () => {
    const { publishedAssessmentGrid } = runtime().load("lib/assessment-booking.ts");
    const data = availability();
    data.slots.push({ ...data.slots[0], id: "occupied", startsAt: "2026-10-04T06:00:00Z", endsAt: "2026-10-04T06:40:00Z", available: false });
    const grid = publishedAssessmentGrid({ availability: data, campusId, facilitatorId: assessorId, weekIndex: 0,
      selectedSlotId: slotId, weekdays: ["周一", "周二", "周三", "周四", "周五", "周六", "周日"], periods: ["上午", "下午", "晚上"], now });
    expect(grid.days.map(day => day.weekday)).toEqual(["周四", "周五", "周六", "周日", "周一", "周二", "周三"]);
    expect(grid.weeks.map(week => week.label)).toEqual(["10.1~10.7", "10.8~10.14"]);
    expect(grid.timeRows).toHaveLength(1);
    expect(grid.timeRows[0]).toMatchObject({ start: "14:00", end: "14:40", period: "下午" });
    expect(grid.timeRows[0].cells.filter(cell => cell.available).map(cell => cell.id)).toEqual([slotId]);
    expect(grid.timeRows[0].cells[3]).toMatchObject({ id: "occupied", available: false, selected: false });
  });

  it("科目可多选确认，改年级清除原校区老师时段，迟到的旧时段响应不回填", async () => {
    vi.useFakeTimers({ now });
    const { page, getAssessmentSlots } = await assessmentPage(vi.fn());
    expect(page.data.selectedTopics).toEqual(["math", "english"]);
    expect(page.data.facilitatorId).toBe("");
    await selectAssessment(page);
    expect(page.data.selectedSlotId).toBe(slotId);
    const slow = deferred<AssessmentAvailability>();
    getAssessmentSlots.mockReturnValueOnce(slow.promise);
    const old = page.loadAvailability();
    page.back(); page.chooseStage({ currentTarget: { dataset: { stageNumber: 4 } } });
    slow.resolve(availability()); await old;
    expect(page.availabilitySnapshot).toBeNull();
    expect(page.data.campusId).toBe(""); expect(page.data.facilitatorId).toBe(""); expect(page.data.selectedSlotId).toBe("");
  });

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

  it("测评意向时间使用上海日期，网格限制过去时间与开放日期范围", () => {
    const { assessmentDay, assessmentWeek, assessmentGrid, assessmentTimeLabel } = runtime().load("lib/assessment-calendar.ts");
    const instant = Date.parse("2026-10-01T02:00:00Z");
    expect(assessmentDay(Date.parse("2026-10-01T16:01:00Z"))).toBe("2026-10-02");
    const week = assessmentWeek("2026-10-01");
    expect(week).toBe("2026-09-28");
    const grid = assessmentGrid({ week, firstDay: "2026-10-01", lastDay: "2026-10-03", weekdays: ["一", "二", "三", "四", "五", "六", "日"],
      definitions: [{ key: "09:50", label: "09:50" }, { key: "14:00", label: "14:00" }], selected: ["2026-10-02@14:00"], now: instant });
    expect(grid.timeRows[0].cells.find(cell => cell.value === "2026-10-01@09:50")?.selectable).toBe(false);
    expect(grid.timeRows[1].cells.find(cell => cell.value === "2026-10-02@14:00")).toMatchObject({ selectable: true, selected: true });
    expect(grid.timeRows[1].cells.find(cell => cell.value === "2026-10-04@14:00")?.selectable).toBe(false);
    expect(grid.canPrevious).toBe(false); expect(grid.canNext).toBe(false);
    expect(assessmentTimeLabel("2026-10-02@after_school", "放学后")).toBe("2026.10.02 放学后");
  });

  it("测评未确认请求按账号与孩子隔离，保留原请求号供恢复重试", () => {
    const { pendingAssessment, savePendingAssessment, clearPendingAssessment } = runtime().load("lib/assessment-pending.ts");
    const draft = { id: "00000000-0000-4000-8000-000000000001", facilitatorId: "00000000-0000-4000-8000-000000000002", participantTimeOptions: ["2026-10-03@14:00"] };
    savePendingAssessment("account-a", "participant-a", draft);
    expect(pendingAssessment("account-a", "participant-a")).toEqual(draft);
    expect(pendingAssessment("account-b", "participant-a")).toBeNull();
    expect(pendingAssessment("account-a", "participant-b")).toBeNull();
    clearPendingAssessment("account-a", "participant-a");
    expect(pendingAssessment("account-a", "participant-a")).toBeNull();
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
    navigation.openPage("/pages/calendar/index");
    navigation.openPage("/pages/reservations/index?filter=cancelled");
    navigation.rememberReturn("/pages/agenda/index"); navigation.resumeAfterLogin();
    expect(run.wx.switchTab).toHaveBeenCalledExactlyOnceWith({ url: "/pages/calendar/index" });
    expect(run.wx.navigateTo.mock.calls).toEqual([[{ url: "/pages/reservations/index?filter=cancelled" }], [{ url: "/pages/agenda/index" }]]);
  });

  it("发现页的活动卡片进入详情，测评继续使用独立入口", () => {
    const run = runtime(); run.load("pages/discover/index.ts"); const page = run.page();
    void page.book(); page.openActivity({ detail: { id: "activity-offer" } });
    expect(run.wx.navigateTo.mock.calls).toEqual([[{ url: "/pages/assessment/index" }], [{ url: "/pages/activity-detail/index?id=activity-offer" }]]);
    const navigation = run.load("lib/navigation.ts");
    navigation.rememberReturn("/pages/assessment/index?view=history"); navigation.resumeAfterLogin();
    expect(run.wx.navigateTo).toHaveBeenLastCalledWith({ url: "/pages/assessment/index?view=history" });
  });

  it("测评选好科目年级方式、校区老师和发布时段后只预约一次，显示真实确认", async () => {
    vi.useFakeTimers({ now });
    const pending = deferred<AssessmentRequest>();
    const post = vi.fn(() => pending.promise);
    const { page } = await assessmentPage(post);
    await page.submit(); expect(post).not.toHaveBeenCalled();
    await selectAssessment(page);
    const first = page.submit(); await page.submit();
    expect(post).toHaveBeenCalledExactlyOnceWith({ action: "book", id: assessmentId, participantId: "member-a", slotId, topics: ["math", "english"], stageNumber: 3, mode: "campus" });
    pending.resolve(bookedAssessment()); await first;
    expect(page.data.requestSent).toBe(true);
    expect(page.data.requests[0].state).toBe("confirmed");
    expect(page.data.requests[0].confirmedTimeLabel).toBe("2026.10.03 周六 14:00~14:40");
    expect(page.data.pending).toBeNull();
  });

  it("测评申请结果不明时保留原始输入，刷新后重试沿用同一 UUID", async () => {
    vi.useFakeTimers({ now });
    const post = vi.fn().mockRejectedValueOnce(new Error("connection lost")).mockResolvedValue(bookedAssessment());
    const { page } = await assessmentPage(post);
    await selectAssessment(page);
    await page.submit(); expect(page.data.uncertain).toBe(true);
    await page.loadParticipant();
    expect(page.data.uncertain).toBe(true);
    await page.retryPending();
    expect(post.mock.calls[1]).toEqual(post.mock.calls[0]);
    expect(page.data.uncertain).toBe(false); expect(page.data.pending).toBeNull();
  });

  it("读取到同请求的真实测评邀约后解除不确定状态，不重复创建", async () => {
    vi.useFakeTimers({ now });
    const post = vi.fn().mockRejectedValue(new Error("connection lost"));
    const { page, getAssessments } = await assessmentPage(post);
    await selectAssessment(page);
    await page.submit();
    getAssessments.mockResolvedValue(assessmentOverview("member-a", [assessmentRequest()]));
    await page.loadParticipant();
    expect(page.data.showHistory).toBe(true); expect(page.data.uncertain).toBe(false); expect(page.data.pending).toBeNull();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("测评结果不明时先读取事实，确认未创建且仍可申请后才允许重新选择", async () => {
    vi.useFakeTimers({ now });
    const post = vi.fn().mockRejectedValue(new Error("connection lost"));
    const { page } = await assessmentPage(post);
    await selectAssessment(page);
    await page.submit(); page.startOver(); expect(page.data.pending).not.toBeNull();
    await page.loadParticipant(); page.startOver();
    expect(page.data.pending).toBeNull(); expect(page.data.uncertain).toBe(false);
    expect(page.data.step).toBe(1); expect(page.data.facilitatorId).toBe("");
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("测评只确认双方未来具体交集，并携带最新版本，意向时刻不冒充已约", async () => {
    vi.useFakeTimers({ now });
    const request = assessmentRequest({ state: "awaiting_participant", facilitatorTimeOptions: [assessmentTime, "2026-10-03@after_school"],
      sharedTimeOptions: [assessmentTime, "2026-10-03@after_school"], proposedStartsAt: "2026-10-03T06:00:00Z", canConfirm: true });
    const post = vi.fn().mockResolvedValue({ ...request, state: "confirmed", canConfirm: false, confirmedStartsAt: "2026-10-03T06:00:00Z" });
    const { page } = await assessmentPage(post, assessmentOverview("member-a", [request]));
    expect(page.data.requests[0].confirmedTimeLabel).toBe("");
    expect(page.data.requests[0].confirmOptions.map(option => option.value)).toEqual([assessmentTime]);
    page.selectConfirmation({ currentTarget: { dataset: { id: assessmentId, value: "2026-10-03@after_school" } } });
    await page.confirm({ currentTarget: { dataset: { id: assessmentId } } }); expect(post).not.toHaveBeenCalled();
    page.selectConfirmation({ currentTarget: { dataset: { id: assessmentId, value: assessmentTime } } });
    await page.confirm({ currentTarget: { dataset: { id: assessmentId } } });
    expect(post).toHaveBeenCalledExactlyOnceWith({ action: "confirm", id: assessmentId, participantId: "member-a", timeOption: assessmentTime, expectedUpdatedAt: request.updatedAt });
    expect(page.data.requests[0].confirmedTimeLabel).toBe("2026.10.03 14:00");
  });

  it("旧申请结果不明也能确认新读取的另一条真实邀约", async () => {
    vi.useFakeTimers({ now });
    const otherId = "00000000-0000-4000-8000-000000000003";
    const existing = assessmentRequest({ id: otherId, state: "awaiting_participant", facilitatorTimeOptions: [assessmentTime], sharedTimeOptions: [assessmentTime], canConfirm: true });
    const post = vi.fn().mockRejectedValueOnce(new Error("connection lost")).mockResolvedValue({ ...existing, state: "confirmed", canConfirm: false, confirmedStartsAt: "2026-10-03T06:00:00Z" });
    const { page, getAssessments } = await assessmentPage(post);
    await selectAssessment(page); await page.submit();
    getAssessments.mockResolvedValue({ ...assessmentOverview("member-a", [existing]), eligibility: { canRequest: false, reason: "ACTIVE_INVITATION" } });
    await page.loadParticipant();
    expect(page.data.uncertain).toBe(true); expect(page.data.eligible).toBe(false);
    page.selectConfirmation({ currentTarget: { dataset: { id: otherId, value: assessmentTime } } });
    await page.confirm({ currentTarget: { dataset: { id: otherId } } });
    expect(post).toHaveBeenLastCalledWith({ action: "confirm", id: otherId, participantId: "member-a", timeOption: assessmentTime, expectedUpdatedAt: existing.updatedAt });
    expect(page.data.requests[0].state).toBe("confirmed");
  });

  it("测评快速切换孩子时丢弃旧邀约响应", async () => {
    const slow = deferred<AssessmentOverview>();
    const run = runtime({ getAssessments: vi.fn((id: string) => id === "member-a" ? slow.promise : Promise.resolve(assessmentOverview(id, [assessmentRequest({ participantId: id })]))) });
    run.load("pages/assessment/index.ts"); const page = run.page();
    page.setData({ accountId: "account", participants: [{ id: "member-a", name: "Same" }, { id: "member-b", name: "Same" }] });
    const old = page.loadParticipant(); page.setData({ selected: 1 }); await page.loadParticipant();
    slow.resolve(assessmentOverview("member-a", [assessmentRequest()])); await old;
    expect(page.overviewSnapshot?.participantId).toBe("member-b");
    expect(page.data.requests.every(row => row.participantId === "member-b")).toBe(true);
  });

  it.each([
    [{ id: "event/one" }, "/pages/activity-detail/index?id=event%2Fone"],
    [{}, "/pages/activity-catalog/index"],
  ])("旧活动链接保留标识并跳转到当前页面 %j", (query, url) => {
    const run = runtime(); run.load("pages/activity/index.ts"); run.page().onLoad(query);
    expect(run.wx.redirectTo).toHaveBeenCalledExactlyOnceWith({ url });
  });

  const offer = (canApply = true): ActivityOffer => ({ id: "event", kind: "activity", revision: 3,
    title: "观察活动", description: "", priceCents: null, bookingClosesAt: timestamp(2), topic: null,
    registration: { fee: "free", confirmation: "staff", reservesPlace: false, canApply },
    activity: { id: "event-source", targetStages: [3], location: "North", startsAt: timestamp(3), durationMinutes: 60, remaining: 0 } });
  async function signup(command: ReturnType<typeof vi.fn>, canApply = true) {
    const detail = { offer: offer(canApply), page: null, pageRevision: 4 };
    const run = runtime({ activityCommand: command, requestId: () => assessmentId,
      activityRequests: vi.fn().mockResolvedValue([]), activityDetail: vi.fn().mockResolvedValue(detail),
      get: vi.fn().mockResolvedValue({ id: "account", participants: [{ id: "member-a", name: "Same" }, { id: "member-b", name: "Same" }] }) });
    run.load("pages/activity-signup/index.ts"); const page = run.page(); page.onLoad({ id: "event" });
    page.setData({ authenticated: true }); await page.load(); return { run, page };
  }

  it("预登记需要明确确认，取消不提交，重复点击只提交一次且不把申请显示为占位", async () => {
    const pending = deferred<{ id: string }>(), command = vi.fn(() => pending.promise);
    const { run, page } = await signup(command);
    run.wx.showModal.mockResolvedValueOnce({ confirm: false });
    await page.submit(); expect(command).not.toHaveBeenCalled();
    const first = page.submit(); await page.submit();
    expect(command).toHaveBeenCalledExactlyOnceWith({ action: "apply", kind: "activity", id: assessmentId,
      publicationId: "event", revision: 3, participantId: "member-a", pageRevision: 4, answers: {} });
    pending.resolve({ id: assessmentId }); await first;
    expect(page.data.sent).toBe(true); expect(page.data.pending).toBeNull();
    expect(page.data.reservationConfirmed).not.toBe(true);
  });

  it("已关闭的活动不会提交或切换到同名活动", async () => {
    const command = vi.fn(); const { run, page } = await signup(command, false);
    await page.submit(); expect(command).not.toHaveBeenCalled();
    expect(run.wx.showModal).not.toHaveBeenCalled(); expect(page.data.id).toBe("event");
    expect(page.data.error).toBeTruthy();
  });

  it("预登记结果不明时保留原参与人和版本，重开后显式重试沿用同一请求", async () => {
    const command = vi.fn().mockRejectedValueOnce(new Error("connection lost")).mockResolvedValue({ id: assessmentId });
    const { page } = await signup(command);
    page.participant({ detail: { value: "1" } }); await page.submit();
    expect(page.data.pending).toBeTruthy();
    page.participant({ detail: { value: "0" } }); expect(page.data.selected).toBe(1);
    await page.load(); expect(command).toHaveBeenCalledTimes(1);
    expect(page.data.selected).toBe(1); await page.submit();
    expect(command.mock.calls[1]).toEqual(command.mock.calls[0]);
    expect(command.mock.calls[0][0].participantId).toBe("member-b");
    expect(page.data.sent).toBe(true); expect(page.data.pending).toBeNull();
  });

  it("账号读取首次失败，重试成功后仍返回原活动", async () => {
    const get = vi.fn().mockRejectedValueOnce(new Error("connection lost")).mockResolvedValue({ id: "account", displayName: "Member", participants: [] });
    const run = runtime({ get });
    run.load("lib/navigation.ts").rememberReturn("/pages/activity/index?id=event");
    run.load("pages/account/index.ts"); const page = run.page();
    await page.load(); expect(run.wx.navigateTo).not.toHaveBeenCalled();
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
    const slow = deferred<ParticipantCalendar>();
    const run = runtime({ participantCalendar: vi.fn((id: string) => id === "member-a" ? slow.promise : Promise.resolve(participantCalendar(id, "B calendar"))),
      get: vi.fn().mockResolvedValue([booking("a"), booking("b", { participantId: "member-b" })]) });
    run.load("pages/agenda/index.ts"); const page = run.page();
    page.setData({ participants: [{ id: "member-a", name: "Same" }, { id: "member-b", name: "Same" }], month: "2026-10", selectedDate: "2026-10-03" });
    const old = page.loadMonth();
    page.setData({ selected: 1 }); await page.loadMonth();
    expect(page.data.events.map((row: { key: string }) => row.key).sort()).toEqual(["activity-b", "session-session-member-b"]);
    slow.resolve(participantCalendar("member-a", "A calendar")); await old;
    expect(page.data.participantCalendar?.participantId).toBe("member-b");
    expect(page.data.dayEvents.map((row: { title: string }) => row.title)).toContain("B calendar");
  });

  it("快速换月不会被前一个月份的延迟返回覆盖", async () => {
    const slow = deferred<ParticipantCalendar>();
    const request = vi.fn().mockImplementationOnce(() => slow.promise).mockResolvedValue(participantCalendar("member-a", "New month"));
    const run = runtime({ participantCalendar: request, get: vi.fn().mockResolvedValue([]) });
    run.load("pages/agenda/index.ts"); const page = run.page();
    page.setData({ participants: [{ id: "member-a", name: "A" }], month: "2026-09" });
    const old = page.loadMonth(); page.setData({ month: "2026-10" }); await page.loadMonth();
    slow.resolve(participantCalendar("member-a", "Old month")); await old;
    expect(page.data.participantCalendar?.calendar[0].title).toBe("New month");
  });

  it("周课表切换同名孩子后，保留新孩子的课次并丢弃旧响应", async () => {
    const slow = deferred<ParticipantCalendar>();
    const request = vi.fn((id: string) => id === "member-a" ? slow.promise : Promise.resolve({ ...participantCalendar(id, "B calendar"),
      summary: { stageNumber: 8, nextSessionAt: null, weekSessionCount: 1, starTotal: 0 },
      calendar: [...participantCalendar(id, "B calendar").calendar, ...participantCalendar("other", "Other calendar").calendar] }));
    const run = runtime({ participantCalendar: request, get: vi.fn().mockResolvedValue([]) }); run.load("pages/calendar/index.ts"); const page = run.page();
    page.setData({ participants: [{ id: "member-a", name: "Same" }, { id: "member-b", name: "Same" }], selectedDate: "2026-10-03" });
    const old = page.loadWeek();
    page.setData({ selected: 1 }); await page.loadWeek();
    slow.resolve(participantCalendar("member-a", "A calendar")); await old;
    expect(page.data.daySessions.map(row => row.title)).toEqual(["B calendar"]);
    expect(page.data.daySessions[0].participantId).toBe("member-b");
    expect(page.data.stageLabel).toBe("初二");
  });

  it("周课表与月课表显示同一天的相同真实安排，按孩子和业务 ID 区分同名记录", async () => {
    const info = participantCalendar("member-a", "同名课程");
    const rows = [booking("same-name", { title: { zh: "同名课程", en: "Same title" } }),
      booking("other-participant", { participantId: "member-b" }), booking("cancelled", { status: "cancelled" }),
      booking("previous-month", { startsAt: new Date(2026, 8, 30, 14).toISOString() }),
      booking("next-week", { startsAt: timestamp(5) })];
    const api = { participantCalendar: vi.fn().mockResolvedValue(info), get: vi.fn().mockResolvedValue(rows) };
    const weekRun = runtime(api); weekRun.load("pages/calendar/index.ts"); const week = weekRun.page();
    week.setData({ participants: [{ id: "member-a", name: "Same" }], selectedDate: "2026-10-03", stageLabel: "初二" });
    await week.loadWeek();
    const monthRun = runtime(api); monthRun.load("pages/agenda/index.ts"); const month = monthRun.page();
    month.setData({ participants: [{ id: "member-a", name: "Same" }], month: "2026-10", selectedDate: "2026-10-03" });
    await month.loadMonth();
    expect(week.data.daySessions).toEqual(month.data.dayEvents);
    expect(week.data.daySessions).toHaveLength(2);
    expect(week.data.daySessions.map(row => row.title)).toEqual(["同名课程", "同名课程"]);
    expect(week.data.sessions).toEqual(expect.arrayContaining([expect.objectContaining({ key: "activity-previous-month" })]));
    expect(week.data.sessions).not.toEqual(expect.arrayContaining([expect.objectContaining({ key: "activity-next-week" })]));
    expect(month.data.events).not.toEqual(expect.arrayContaining([expect.objectContaining({ key: "activity-previous-month" })]));
    expect(week.data.stageLabel).toBe("");
  });

  it.each(["calendar", "agenda"])("%s 的课表接口暂不可用时，仍显示已读取的活动并保留重试提示", async pageName => {
    const run = runtime({ participantCalendar: vi.fn().mockRejectedValue(new Error("Unavailable")), get: vi.fn().mockResolvedValue([booking("confirmed")]) });
    run.load(`pages/${pageName}/index.ts`); const page = run.page();
    page.setData({ participants: [{ id: "member-a", name: "Same" }], month: "2026-10", selectedDate: "2026-10-03" });
    if (pageName === "calendar") await page.loadWeek(); else await page.loadMonth();
    expect(pageName === "calendar" ? page.data.daySessions : page.data.dayEvents).toEqual([
      expect.objectContaining({ key: "activity-confirmed", kind: "activity", participantId: "member-a", endTime: "" }),
    ]);
    expect(page.data.error).toBeTruthy();
  });
});
