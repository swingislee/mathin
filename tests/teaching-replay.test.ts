import { createElement, type ComponentProps, type ComponentType, type PropsWithChildren } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "../messages/zh.json";
import { selectTeachingReplay, teachingReplayAllowed, teachingReplayDetail, teachingReplayOverview, teachingReplaySchema, type TeachingReplay } from "@/features/school/teaching-workbench/teaching-replay-contract";
import { TeachingClassOverviewTable } from "@/features/school/teaching-workbench/TeachingClassOverviewTable";
import { TeachingSessionRecords } from "@/features/school/teaching-workbench/TeachingSessionRecords";
import { groupTeachingClasses } from "@/features/school/teaching-workbench/teaching-class-overview-contract";
import { hasWrittenReview } from "@/features/school/teaching-workbench/teaching-learning-summary";
import { readTeachingInlineRecords, type TeachingRecordCache } from "@/features/school/teaching-workbench/teaching-records-client";

vi.mock("@/i18n/navigation", () => ({ Link: ({ children, ...props }: ComponentProps<"a">) => createElement("a", props, children) }));
const id = "00000000-0000-4000-8000-000000000001";
const at = "2026-09-07T00:00:00+08:00";
const session = { id, classroomId: "class", classroomName: "示例班", title: "解决问题", scheduledAt: at, startedAt: at, endedAt: null };
const blankReview = { studentId: "a", comment: "  ", entryScore: null, exitScore: null, focus: null, participation: null, mastery: null, updatedAt: at, author: null };
const fixture = (): TeachingReplay => teachingReplaySchema.parse({
  version: 1, source: "production", capturedAt: "2026-09-15T03:00:00Z", timeZone: "Asia/Shanghai",
  from: "2026-09-06T16:00:00.000Z", to: "2026-09-13T16:00:00.000Z",
  teachers: [{ id, name: "老师甲" }, { id: "00000000-0000-4000-8000-000000000002", name: "老师乙" }],
  sessions: [{ ...session, teachers: [{ id, name: "老师甲" }] }],
  records: { [id]: { session, students: [{ id: "a", name: "学生甲" }, { id: "b", name: "学生乙" }, { id: "c", name: "学生丙" }], attendance: [],
    checks: [{ id: "check", title: "练习4.1" }, { id: "empty", title: "未记录题" }],
    results: [{ checkId: "check", studentId: "a", status: "prompted", markedAt: at, author: "老师甲" }, { checkId: "check", studentId: "b", status: "independent", markedAt: at, author: "老师甲" }],
    reviews: [blankReview, { ...blankReview, studentId: "b", comment: "解释准确" }],
    contacts: [{ id: "contact", studentId: "a", content: "学生背景参考".repeat(60), kind: "class", createdAt: at, occurredOn: null, author: null }],
    contactPage: 1, contactTotal: 1, canReadContacts: true, supportNotes: [],
  } },
});
const Provider = NextIntlClientProvider as ComponentType<PropsWithChildren<Omit<ComponentProps<typeof NextIntlClientProvider>, "children">>>;

describe("local production teaching replay", () => {
  it("distinguishes pre-launch periods from uncaptured periods at the Shanghai date boundary", () => {
    const source = teachingReplaySchema.parse({ ...fixture(), startedOn: "2026-09-07" });
    expect(selectTeachingReplay(source, { start: "2026-08-31T16:00:00Z", end: source.from }).beforeStart).toBe(true);
    expect(selectTeachingReplay(source, { start: source.from, end: "2026-09-06T17:00:00Z" }).beforeStart).toBe(false);
    expect(selectTeachingReplay(source, { start: "2026-08-31T16:00:00Z", end: source.to }).beforeStart).toBe(false);
    expect(selectTeachingReplay(fixture(), { start: "2026-08-31T16:00:00Z", end: source.from }).beforeStart).toBe(false);
  });
  it("filters periods and contact dates without presenting uncaptured periods as complete", () => {
    const source = fixture();
    expect(selectTeachingReplay(source, { start: source.from, end: source.to }).coverage).toBe("full");
    expect(selectTeachingReplay(source, { start: "2026-08-31T16:00:00Z", end: "2026-09-30T16:00:00Z" }).coverage).toBe("partial");
    const empty = selectTeachingReplay(source, { start: source.to, end: "2026-09-20T16:00:00Z" });
    expect(empty.coverage).toBe("none"); expect(empty.snapshot.sessions).toEqual([]);
    source.version = 2; source.from = "2026-08-31T16:00:00Z"; source.to = "2026-09-30T16:00:00Z";
    source.records[id].contacts.push({ ...source.records[id].contacts[0], id: "outside", createdAt: "2026-09-20T00:00:00Z", occurredOn: null });
    source.records[id].contacts.push({ ...source.records[id].contacts[0], id: "entered-later", createdAt: "2026-09-20T00:00:00Z", occurredOn: "2026-09-10" });
    const week = selectTeachingReplay(teachingReplaySchema.parse(source), { start: "2026-09-06T16:00:00Z", end: "2026-09-13T16:00:00Z" });
    expect(week.snapshot.records[id].contacts.map(row => row.id)).toEqual(["contact", "entered-later"]);
    expect(source.records[id].contacts).toHaveLength(3);
  });
  it("accepts a third teacher and retains explicit grades without requiring a system start", () => {
    const snapshot = fixture();
    snapshot.teachers.push({ id: "00000000-0000-4000-8000-000000000003", name: "老师丙" });
    snapshot.sessions[0] = { ...snapshot.sessions[0], teachers: [snapshot.teachers[2]], classroomGrade: 6, startedAt: null, endedAt: null };
    const parsed = teachingReplaySchema.parse(snapshot);
    expect(parsed.teachers).toHaveLength(3);
    const rows = groupTeachingClasses(teachingReplayOverview(parsed), snapshot.teachers[2].id);
    expect(rows[0]).toMatchObject({ grade: 6, ratedCount: 2, endedSessions: 0 });
  });
  it("requires development, the exact local database origin, and both management and communication permissions", () => {
    const perms = new Set(["class.view.all", "followup.view"]);
    expect(teachingReplayAllowed("development", "http://127.0.0.1:35421", perms)).toBe(true);
    for (const nodeEnv of [undefined, "test", "production"]) expect(teachingReplayAllowed(nodeEnv, "http://127.0.0.1:35421", perms)).toBe(false);
    for (const origin of [undefined, "https://supabase.mathin.club", "http://192.168.5.183:35421", "http://127.0.0.1:35421.evil.test"]) expect(teachingReplayAllowed("development", origin, perms)).toBe(false);
    for (const denied of [[], ["class.view.all"], ["followup.view"], ["class.view.own", "followup.view"]]) expect(teachingReplayAllowed("development", "http://127.0.0.1:35421", new Set(denied))).toBe(false);
  });

  it("keeps recorded observations, question coverage, attendance and substantive reviews separate", () => {
    const overview = teachingReplayOverview(fixture());
    const group = groupTeachingClasses(overview)[0];
    expect(group).toMatchObject({ rosterEntries: 3, ratedCount: 2, expectedRatings: 6, reviewCount: 1, endedSessions: 0,
      attendance: { marked: 0, absent: 0 }, observations: { independent: 1, prompted: 1, incomplete: 0, recordedChecks: 1, totalChecks: 2,
        focusChecks: [{ title: "练习4.1", recorded: 2, supported: 1 }] } });
    expect(group.attention).toEqual([{ id: "a", name: "学生甲" }]);
    expect(hasWrittenReview(blankReview)).toBe(false);
    expect(hasWrittenReview({ ...blankReview, entryScore: 0 })).toBe(true);
    expect(teachingReplayDetail(fixture(), id, 1, 20).reviews).toHaveLength(1);
  });

  it("treats the week as a Shanghai time interval, including its start and excluding its end", () => {
    expect(teachingReplayOverview(fixture()).metrics).toHaveLength(1);
    for (const outside of ["2026-09-06T23:59:59+08:00", "2026-09-14T00:00:00+08:00", "not-a-date"]) {
      const snapshot = fixture(); snapshot.sessions[0].scheduledAt = outside;
      expect(() => teachingReplayOverview(snapshot)).toThrow("REPLAY_PERIOD_MISMATCH");
    }
    const snapshot = fixture(); snapshot.records[id].session.classroomId = "unrelated";
    expect(() => teachingReplayOverview(snapshot)).toThrow("REPLAY_RECORD_MISMATCH");
  });

  it("keeps student background provenance and only a short snippet in the initial overview", () => {
    const snapshot = fixture();
    const data = teachingReplayOverview(snapshot);
    expect(data.classContacts[0].latest).toMatchObject({ author: null, eventDate: null, at });
    expect(data.classContacts[0].latest?.content).toHaveLength(96);
    expect(data).not.toHaveProperty("records");
    expect(data.metrics[0]).not.toHaveProperty("results");
    expect(teachingReplayDetail(snapshot, id, 1, 20).contacts[0].content).toBe(snapshot.records[id].contacts[0].content);
  });

  it("restricts detail requests to captured sessions and pages the snapshot contacts", () => {
    const snapshot = fixture();
    expect(() => teachingReplayDetail(snapshot, "unrelated", 1, 20)).toThrow("REPLAY_SESSION_NOT_FOUND");
    snapshot.records[id].contacts = Array.from({ length: 23 }, (_, i) => ({ ...snapshot.records[id].contacts[0], id: `contact-${i}` }));
    const page = teachingReplayDetail(snapshot, id, 100, 10);
    expect(page).toMatchObject({ contactPage: 3, contactTotal: 23 });
    expect(page.contacts.map(item => item.id)).toEqual(["contact-20", "contact-21", "contact-22"]);
    expect(teachingReplaySchema.safeParse({ ...snapshot, from: "2026-09-01T00:00:00Z" }).success).toBe(false);
  });

  it("keeps replay and live responses in separate page caches", async () => {
    const cache: TeachingRecordCache = new Map();
    const live = fixture().records[id];
    const replay = { ...live, contacts: [] };
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(live)).mockResolvedValueOnce(Response.json(replay));
    vi.stubGlobal("fetch", fetcher);
    try {
      const query = { sessionId: id, contactPage: 1, pageSize: 20 as const };
      await readTeachingInlineRecords(cache, "zh", query, new AbortController().signal);
      const replayQuery = { ...query, replayId: "2026-09-07" as const };
      const data = await readTeachingInlineRecords(cache, "zh", replayQuery, new AbortController().signal);
      expect(data.contacts).toEqual([]);
      await readTeachingInlineRecords(cache, "zh", replayQuery, new AbortController().signal);
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject(replayQuery);
      expect(cache.size).toBe(2);
      fetcher.mockResolvedValueOnce(Response.json(replay));
      await readTeachingInlineRecords(cache, "zh", { ...replayQuery, replayFrom: "2026-08-31T16:00:00Z", replayTo: "2026-09-30T16:00:00Z" }, new AbortController().signal);
      expect(fetcher).toHaveBeenCalledTimes(3);
      expect(cache.size).toBe(3);
    } finally { vi.unstubAllGlobals(); }
  });

  it("shows useful observations and date uncertainty without linking production class IDs into local records", () => {
    const html = renderToStaticMarkup(createElement(Provider, { locale: "zh", messages, timeZone: "Asia/Shanghai" }, createElement(TeachingClassOverviewTable, {
      data: teachingReplayOverview(fixture()), locale: "zh", timeZone: "Asia/Shanghai", returnTo: "/dashboard/teaching/review", replayId: "2026-09-07",
    })));
    for (const text of ["独立完成 · 1", "提示完成 · 1", "练习4.1", "需支持 1/2 次", "已记 1/2 题", "已填课评 1 人次", "考勤未记录", "1 节未记下课", "沟通日期未注明"]) expect(html).toContain(text);
    expect(html).toContain("data-teaching-performance");
    expect(html).not.toContain("/dashboard/classes/class");
    expect(html).not.toContain("系统上课中");
  });

  it.each([true, false])("shows per-question coverage and full original text in lesson detail (replay=%s)", replay => {
    const snapshot = fixture();
    const html = renderToStaticMarkup(createElement(Provider, { locale: "zh", messages, timeZone: "Asia/Shanghai" }, createElement(TeachingSessionRecords, {
      data: teachingReplayDetail(snapshot, id, 1, 20), locale: "zh", timeZone: "Asia/Shanghai", returnTo: "", currentHref: "", replay,
      inline: { onPageChange: () => {}, onPageSizeChange: () => {} },
    })));
    expect(html).toContain("已记 2/3 人 · 支持 1");
    expect(html).toContain("已记 0/3 人 · 支持 0");
    expect(html).toContain(snapshot.records[id].contacts[0].content);
    expect(html).toContain("沟通日期未注明");
    expect(html).toContain("录入");
  });
});
