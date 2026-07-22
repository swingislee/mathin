import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import {
  getDueOrders,
  getActivityToday,
  getReviewGaps,
  getVideoQueue,
  getRenewalDueCount,
  getFinanceOverview,
  getFollowUpFunnel,
  getFollowupBoardCounts,
  getGradingQueue,
  getMyClassroomCards,
  getMyMonthlyPerformance,
  getMyOverdueFollowUps,
  getMyTeachingCard,
  getRosterMismatchCount,
  getStaffStats,
  getTemplateProgress,
  getTemplateUrgent,
  getTodaySchedule,
  getUnmarkedSessions,
  type DueOrderRow,
  type ActivityTodayRow,
  type ReviewGapRow,
  type VideoQueueRow,
  type FinanceOverview,
  type FollowUpFunnelBucket,
  type FollowupBoardCounts,
  type GradingQueueRow,
  type MyClassroomCard,
  type MyOverdueFollowUp,
  type MyPerformance,
  type MyTeachingCard,
  type RosterMismatch,
  type StaffStats,
  type TemplateProgressRow,
  type TemplateUrgentRow,
  type TodaySessionRow,
  type UnmarkedSessionRow,
} from "@/features/school/dashboard";
import { loadCoursewareTaskQueue, type CoursewareTaskItem } from "@/features/courseware-studio/data";
import { countPendingRefunds } from "@/features/school/finance";
import { listMySupportTasks } from "@/features/school/support-tasks";
import type { SupportTaskRow } from "@/features/school/support-tasks";
import { SupportTaskList } from "@/features/school/SupportTaskList";
import { mergeTileLayout, staffDefaultOrder, type TileTone } from "@/features/school/tiles";
import { TileWorkspace } from "@/features/school/TileWorkspace";
import { Link } from "@/i18n/navigation";
import { getMyPerms } from "@/lib/auth";
import { cn } from "@/lib/utils";
import {
  buildTileItems,
  CompactBody,
  EmptyBody,
  EMPTY_FINANCE,
  EMPTY_FOLLOWUP_COUNTS,
  EMPTY_MISMATCH,
  EMPTY_PERFORMANCE,
  EMPTY_STATS,
  EMPTY_TEACHING,
  MinimalBody,
  pickEligible,
  safe,
  StatBody,
  type HomeProps,
  type TileExtra,
} from "./shared";

// P4I-17：不再是 staff 默认首页（该角色改挂 TodayWorkHome），只作为
// `/dashboard/operations/legacy-home` 的只读磁贴对账视图存在——用来核对
// 新工作项投影的数量是否与旧磁贴一致，P4I-19 会整体删除这个组件。因此
// 不再读 `dashboard_layouts`（用户自定义布局对一个只读页没有意义，永远
// 走默认序），`TileWorkspace` 也传 `readOnly` 关掉编辑/拖拽/保存。
/** 磁贴只读对账视图（原员工首页，P4G-7 拆出）。 */
export async function StaffHome({ locale, user, profile }: HomeProps) {
  const schoolT = await getTranslations("school");
  const perms = await getMyPerms(user.id);
  const userTiles = null;
  const dateLine = new Intl.DateTimeFormat(locale, { dateStyle: "full" }).format(new Date());
  const subtitle = `${schoolT("home.staffGreeting", { name: profile?.displayName || "" })} · ${dateLine}`;
  const cny = new Intl.NumberFormat(locale, { style: "currency", currency: "CNY" });
  const timeFmt = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" });
  const shortFmt = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" });
  const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: "short" });
  const labels = new Map<string, string>();
  const contents = new Map<string, ReactNode>();
  const extras = new Map<string, TileExtra>();

    const studentsFilterT = await getTranslations("school.students");
    const canStats = perms.has("student.view.all");
    const canMyFollowUps = perms.has("followup.view");
    const canMyPerformance = perms.has("finance.order.view") || perms.has("finance.order.create");
    const canMyTeaching = perms.has("class.view.mine");
    const canFinanceOverview = perms.has("finance.report.view");
    const canRefundQueue = perms.has("finance.refund.approve");
    const canSeeAllSchedule = perms.has("schedule.view.all");
    const canGrading = perms.has("grading.write");
    const canCourseManage = perms.has("course.manage");
    const canClassViewAll = perms.has("class.view.all");
    const canFollowupWrite = perms.has("followup.write");
    const canActivity = perms.has("activity.register");
    const canReview = perms.has("review.write");
    const canVideoReview = perms.has("video.review");
    const canRenewal = perms.has("finance.order.view")||perms.has("followup.view");
    const canCoursewareTasks = perms.has("courseware.page.edit");
    const canSupportTasks = canFollowupWrite || perms.has("attendance.mark") || perms.has("class.manage") || canClassViewAll;

    const [
      stats,
      funnel,
      todaySessions,
      myFollowUps,
      myPerformance,
      myTeaching,
      myClassrooms,
      financeOverview,
      pendingRefundCount,
      gradingQueue,
      dueOrders,
      templateUrgent,
      templateProgress,
      unmarkedSessions,
      rosterMismatch,
      followupCounts,
      activityToday,
      reviewGaps,
      videoQueue,
      renewalDue,
      coursewareTasks,
      supportTasks,
    ]: [
      StaffStats,
      FollowUpFunnelBucket[],
      TodaySessionRow[],
      MyOverdueFollowUp[],
      MyPerformance,
      MyTeachingCard,
      MyClassroomCard[],
      FinanceOverview,
      number,
      GradingQueueRow[],
      DueOrderRow[],
      TemplateUrgentRow[],
      TemplateProgressRow[],
      UnmarkedSessionRow[],
      RosterMismatch,
      FollowupBoardCounts,
      ActivityTodayRow[],
      ReviewGapRow[],
      VideoQueueRow[],
      number,
      CoursewareTaskItem[],
      SupportTaskRow[],
    ] = await Promise.all([
      canStats ? safe(getStaffStats, EMPTY_STATS) : Promise.resolve(EMPTY_STATS),
      canStats ? safe(getFollowUpFunnel, []) : Promise.resolve([]),
      safe(getTodaySchedule, []),
      canMyFollowUps ? safe(() => getMyOverdueFollowUps(user.id), []) : Promise.resolve([]),
      canMyPerformance ? safe(() => getMyMonthlyPerformance(user.id), EMPTY_PERFORMANCE) : Promise.resolve(EMPTY_PERFORMANCE),
      canMyTeaching ? safe(() => getMyTeachingCard(user.id), EMPTY_TEACHING) : Promise.resolve(EMPTY_TEACHING),
      canMyTeaching ? safe(() => getMyClassroomCards(user.id), []) : Promise.resolve([]),
      canFinanceOverview ? safe(getFinanceOverview, EMPTY_FINANCE) : Promise.resolve(EMPTY_FINANCE),
      canRefundQueue ? safe(countPendingRefunds, 0) : Promise.resolve(0),
      canGrading ? safe(() => getGradingQueue(user.id), []) : Promise.resolve([]),
      canMyPerformance ? safe(getDueOrders, []) : Promise.resolve([]),
      canCourseManage ? safe(getTemplateUrgent, []) : Promise.resolve([]),
      canCourseManage ? safe(getTemplateProgress, []) : Promise.resolve([]),
      canClassViewAll ? safe(getUnmarkedSessions, []) : Promise.resolve([]),
      canClassViewAll ? safe(getRosterMismatchCount, EMPTY_MISMATCH) : Promise.resolve(EMPTY_MISMATCH),
      canFollowupWrite ? safe(getFollowupBoardCounts, EMPTY_FOLLOWUP_COUNTS) : Promise.resolve(EMPTY_FOLLOWUP_COUNTS),
      canActivity ? safe(getActivityToday, []) : Promise.resolve([]),
      canReview ? safe(getReviewGaps, []) : Promise.resolve([]),
      canVideoReview ? safe(getVideoQueue, []) : Promise.resolve([]),
      canRenewal ? safe(getRenewalDueCount,0) : Promise.resolve(0),
      canCoursewareTasks ? safe(() => loadCoursewareTaskQueue("incomplete", ""), []) : Promise.resolve([]),
      canSupportTasks ? safe(() => listMySupportTasks(), []) : Promise.resolve([]),
    ]);

    const funnelMax = Math.max(1, ...funnel.map((bucket) => bucket.count));
    const isManager = canStats;

    // ---- 统计四贴（整贴可点） ----
    const statTiles: Array<{ key: string; label: string; value: number; href: string; tone?: TileTone }> = [
      { key: "statEnrolled", label: schoolT("home.statEnrolled"), value: stats.enrolledCount, href: "/dashboard/students" },
      { key: "statLeads", label: schoolT("home.statLeads"), value: stats.leadCount, href: "/dashboard/students?status=lead" },
      { key: "statWeekSessions", label: schoolT("home.statWeekSessions"), value: stats.weekSessionCount, href: "/dashboard/schedule" },
      {
        key: "statOverdueFollowUps",
        label: schoolT("home.statOverdueFollowUps"),
        value: stats.overdueFollowUpCount,
        href: "/dashboard/students",
        tone: "rose",
      },
    ];
    for (const stat of statTiles) {
      labels.set(stat.key, stat.label);
      extras.set(stat.key, { href: stat.href, cover: true });
      contents.set(stat.key, <StatBody value={stat.value} tone={stat.tone} />);
    }

    // ---- 今日课表 ----
    labels.set("todaySchedule", canSeeAllSchedule ? schoolT("home.todayScheduleTitle") : schoolT("home.todayScheduleTitleMine"));
    extras.set("todaySchedule", {
      href: "/dashboard/schedule",
      minimal: <MinimalBody value={todaySessions.length} />,
      compact: (
        <CompactBody
          value={todaySessions.length}
          line={
            todaySessions[0]
              ? `${timeFmt.format(new Date(todaySessions[0].scheduledAt))} ${todaySessions[0].classroomName}`
              : schoolT("home.todayScheduleEmpty")
          }
        />
      ),
    });
    contents.set(
      "todaySchedule",
      todaySessions.length === 0 ? (
        <EmptyBody text={schoolT("home.todayScheduleEmpty")} href="/dashboard/schedule" linkLabel={schoolT("nav.schedule")} />
      ) : (
        <ul className="min-h-0 flex-1 divide-y overflow-hidden">
          {todaySessions.slice(0, 12).map((session) => (
            <li key={session.sessionId} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <span className="w-12 shrink-0 font-mono text-xs text-muted">{timeFmt.format(new Date(session.scheduledAt))}</span>
              <span className="min-w-[7rem] flex-1 truncate font-medium">{session.classroomName}</span>
              <span className="max-w-[10rem] shrink-0 truncate text-xs text-muted">{session.title}</span>
              {session.teacherName && (
                <span className="shrink-0 rounded-full bg-line/50 px-2 py-0.5 text-xs text-muted">{session.teacherName}</span>
              )}
            </li>
          ))}
        </ul>
      ),
    );

    // ---- 生源漏斗 ----
    const funnelTotal = funnel.reduce((sum, bucket) => sum + bucket.count, 0);
    labels.set("funnel", schoolT("home.funnelTitle"));
    extras.set("funnel", {
      minimal: <MinimalBody value={funnelTotal} />,
      compact: (
        <CompactBody
          value={funnelTotal}
          line={funnel
            .slice(0, 2)
            .map((bucket) => `${studentsFilterT(bucket.status)} ${bucket.count}`)
            .join(" · ")}
        />
      ),
    });
    contents.set(
      "funnel",
      <ul className="grid flex-1 content-center gap-1.5">
        {funnel.map((bucket) => (
          <li key={bucket.status} className="flex items-center gap-3 text-sm">
            <span className="w-14 shrink-0 truncate text-xs text-muted">{studentsFilterT(bucket.status)}</span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-line/40">
              <span
                className="block h-full rounded-full bg-crater/50"
                style={{ width: `${Math.round((bucket.count / funnelMax) * 100)}%` }}
              />
            </span>
            <span className="w-8 shrink-0 text-right font-display tabular-nums">{bucket.count}</span>
          </li>
        ))}
      </ul>,
    );

    // ---- 我的待跟进 ----
    labels.set("myFollowUps", schoolT("home.myFollowUpsTitle"));
    extras.set("myFollowUps", {
      href: "/dashboard/students",
      minimal: <MinimalBody value={myFollowUps.length} rose={myFollowUps.length > 0} />,
      compact: (
        <CompactBody
          value={myFollowUps.length}
          rose={myFollowUps.length > 0}
          line={
            myFollowUps[0]
              ? `${myFollowUps[0].studentName} · ${dateFmt.format(new Date(myFollowUps[0].nextFollowUpAt))}`
              : schoolT("home.myFollowUpsEmpty")
          }
        />
      ),
    });
    contents.set(
      "myFollowUps",
      myFollowUps.length === 0 ? (
        <EmptyBody text={schoolT("home.myFollowUpsEmpty")} href="/dashboard/students" linkLabel={schoolT("nav.students")} />
      ) : (
        <ul className="min-h-0 flex-1 divide-y overflow-hidden">
          {myFollowUps.map((row) => (
            <li key={row.studentId} className="flex items-center justify-between gap-3 py-2 text-sm">
              <Link href={`/dashboard/students/${row.studentId}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                {row.studentName}
              </Link>
              <span className="shrink-0 rounded-full bg-rose/10 px-2 py-0.5 text-xs text-rose">
                {dateFmt.format(new Date(row.nextFollowUpAt))}
              </span>
            </li>
          ))}
        </ul>
      ),
    );

    // ---- 本月业绩 ----
    labels.set("myPerformance", schoolT("home.myPerformanceTitle"));
    extras.set("myPerformance", {
      href: "/dashboard/finance",
      // 2x1 的 full（三小数并排）本就放得下，只补 1x1 的单金额档。
      minimal: <MinimalBody value={cny.format(myPerformance.paidTotal)} />,
    });
    contents.set(
      "myPerformance",
      <div className="flex flex-1 flex-wrap content-center items-center gap-x-6 gap-y-2">
        {[
          { value: cny.format(myPerformance.dueTotal), label: schoolT("home.performanceDue") },
          { value: cny.format(myPerformance.paidTotal), label: schoolT("home.performancePaid") },
          { value: String(myPerformance.enrollCount), label: schoolT("home.performanceEnrolls") },
        ].map((item) => (
          <div key={item.label}>
            <p className="font-display text-xl tabular-nums">{item.value}</p>
            <p className="mt-0.5 text-xs text-muted">{item.label}</p>
          </div>
        ))}
      </div>,
    );

    // ---- 我的课与待办 ----
    labels.set("myTeaching", schoolT("home.myTeachingTitle"));
    extras.set("myTeaching", {
      href: "/dashboard/classes?scope=teaching",
      minimal: <MinimalBody value={myTeaching.sessions.length} />,
      compact: (
        <CompactBody
          value={myTeaching.sessions.length}
          line={
            myTeaching.sessions[0]
              ? `${myTeaching.sessions[0].classroomName} · ${shortFmt.format(new Date(myTeaching.sessions[0].scheduledAt))}`
              : schoolT("home.myTeachingEmpty")
          }
        />
      ),
    });
    contents.set(
      "myTeaching",
      <>
        {myTeaching.pendingGradingCount > 0 && (
          <Link href="/dashboard/classes?scope=teaching" className="mb-1 shrink-0 self-start text-xs text-rose underline underline-offset-2">
            {schoolT("home.pendingGrading", { count: myTeaching.pendingGradingCount })}
          </Link>
        )}
        {myTeaching.sessions.length === 0 ? (
          <EmptyBody text={schoolT("home.myTeachingEmpty")} href="/dashboard/classes?scope=teaching" linkLabel={schoolT("nav.classes")} />
        ) : (
          <ul className="min-h-0 flex-1 divide-y overflow-hidden">
            {myTeaching.sessions.slice(0, 6).map((session) => (
              <li key={session.sessionId} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <span className="min-w-[7rem] flex-1 truncate font-medium">{session.classroomName}</span>
                <span className="shrink-0 text-xs text-muted">{session.title}</span>
                <time className="shrink-0 text-xs text-muted">{shortFmt.format(new Date(session.scheduledAt))}</time>
                {session.unprepared && (
                  <span className="shrink-0 rounded-full bg-rose/10 px-2 py-0.5 text-xs text-rose">{schoolT("home.unprepared")}</span>
                )}
                <Link
                  href={`/classroom/${session.classroomId}/session/${session.sessionId}`}
                  className="shrink-0 text-xs text-crater underline underline-offset-2"
                >
                  {session.isToday ? schoolT("home.goTeach") : schoolT("home.goPrepare")}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </>,
    );

    // ---- 我的班级 ----
    labels.set("myClasses", schoolT("home.myClassesTitle"));
    extras.set("myClasses", {
      href: "/dashboard/classes?scope=teaching",
      minimal: <MinimalBody value={myClassrooms.length} />,
      compact: (
        <CompactBody
          value={myClassrooms.length}
          line={myClassrooms[0] ? myClassrooms[0].name : schoolT("home.myClassroomsEmpty")}
        />
      ),
    });
    contents.set(
      "myClasses",
      myClassrooms.length === 0 ? (
        <EmptyBody text={schoolT("home.myClassroomsEmpty")} href="/dashboard/classes?scope=teaching" linkLabel={schoolT("nav.classes")} />
      ) : (
        <ul className="min-h-0 flex-1 divide-y overflow-hidden">
          {myClassrooms.map((classroom) => (
            <li key={classroom.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <Link href={`/dashboard/classes/${classroom.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                {classroom.name}
              </Link>
              <span className="shrink-0 text-xs text-muted">
                {classroom.capacity
                  ? schoolT("home.classActiveCap", { count: classroom.activeCount, capacity: classroom.capacity })
                  : schoolT("home.classActive", { count: classroom.activeCount })}
              </span>
              <span className="shrink-0 rounded-full bg-line/50 px-2 py-0.5 text-xs text-muted">
                {schoolT("home.classProgress", { done: classroom.doneSessionCount, total: classroom.totalSessionCount })}
              </span>
            </li>
          ))}
        </ul>
      ),
    );

    // ---- 财务概览 ----
    labels.set("financeOverview", schoolT("home.financeOverviewTitle"));
    extras.set("financeOverview", {
      href: "/dashboard/finance",
      minimal: <MinimalBody value={cny.format(financeOverview.paidTotal)} />,
      compact: (
        <CompactBody
          value={cny.format(financeOverview.paidTotal)}
          line={`${schoolT("home.financeDue")} ${cny.format(financeOverview.dueTotal)}`}
        />
      ),
    });
    contents.set(
      "financeOverview",
      <div className="grid flex-1 grid-cols-2 content-center gap-3 lg:grid-cols-4">
        {[
          { value: cny.format(financeOverview.dueTotal), label: schoolT("home.financeDue") },
          { value: cny.format(financeOverview.paidTotal), label: schoolT("home.financePaid") },
          { value: cny.format(financeOverview.refundTotal), label: schoolT("home.financeRefunded") },
          { value: String(financeOverview.overdueOrderCount), label: schoolT("home.financeOverdueOrders") },
        ].map((item) => (
          <div key={item.label}>
            <p className="font-display text-xl tabular-nums">{item.value}</p>
            <p className="mt-0.5 text-xs text-muted">{item.label}</p>
          </div>
        ))}
      </div>,
    );

    // ---- 待审退费（count=0 时不进池，§5.6 自动隐藏） ----
    labels.set("refundQueue", schoolT("home.refundQueueLabel"));
    extras.set("refundQueue", { href: "/dashboard/finance", cover: true });
    contents.set("refundQueue", <StatBody value={pendingRefundCount} tone="rose" />);

    // ---- 批改清单（§0.4）：逐份直达批改页 ----
    labels.set("gradingQueue", schoolT("home.gradingQueueTitle"));
    extras.set("gradingQueue", {
      href: "/dashboard/classes?scope=teaching",
      tone: gradingQueue.length > 0 ? "rose" : undefined,
      minimal: <MinimalBody value={gradingQueue.length} rose={gradingQueue.length > 0} />,
      compact: (
        <CompactBody
          value={gradingQueue.length}
          rose={gradingQueue.length > 0}
          line={
            gradingQueue[0]
              ? `${gradingQueue[0].studentName} · ${gradingQueue[0].assignmentTitle}`
              : schoolT("home.gradingQueueEmpty")
          }
        />
      ),
    });
    contents.set(
      "gradingQueue",
      gradingQueue.length === 0 ? (
        <EmptyBody text={schoolT("home.gradingQueueEmpty")} href="/dashboard/classes?scope=teaching" linkLabel={schoolT("nav.classes")} />
      ) : (
        <ul className="min-h-0 flex-1 divide-y overflow-hidden">
          {gradingQueue.map((row) => (
            <li key={`${row.assignmentId}:${row.studentName}:${row.submittedAt}`} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <span className="shrink-0 font-medium">{row.studentName}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-muted">{row.assignmentTitle}</span>
              <time className="shrink-0 text-xs text-muted">{shortFmt.format(new Date(row.submittedAt))}</time>
              <Link
                href={`/classroom/${row.classroomId}/assignment/${row.assignmentId}`}
                className="shrink-0 text-xs text-crater underline underline-offset-2"
              >
                {schoolT("home.goGrade")}
              </Link>
            </li>
          ))}
        </ul>
      ),
    );

    // ---- 催缴名单（§0.1/§0.5）：scope 由 orders RLS 决定，同贴双 scope ----
    labels.set("dueOrders", schoolT("home.dueOrdersTitle"));
    extras.set("dueOrders", {
      tone: dueOrders.length > 0 ? "rose" : undefined,
      minimal: <MinimalBody value={dueOrders.length} rose={dueOrders.length > 0} />,
      compact: (
        <CompactBody
          value={dueOrders.length}
          rose={dueOrders.length > 0}
          line={
            dueOrders[0]
              ? `${dueOrders[0].studentName} · ${schoolT("home.dueAmount", { amount: cny.format(dueOrders[0].dueAmount) })}`
              : schoolT("home.dueOrdersEmpty")
          }
        />
      ),
    });
    contents.set(
      "dueOrders",
      dueOrders.length === 0 ? (
        <EmptyBody text={schoolT("home.dueOrdersEmpty")} />
      ) : (
        <ul className="min-h-0 flex-1 divide-y overflow-hidden">
          {dueOrders.map((row) => (
            <li key={row.orderId} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <Link href={`/dashboard/students/${row.studentId}#finance`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                {row.studentName}
              </Link>
              <span className="shrink-0 rounded-full bg-rose/10 px-2 py-0.5 text-xs tabular-nums text-rose">
                {schoolT("home.dueAmount", { amount: cny.format(row.dueAmount) })}
              </span>
              <time className="shrink-0 text-xs text-muted">{dateFmt.format(new Date(row.createdAt))}</time>
            </li>
          ))}
        </ul>
      ),
    );

    // ---- 倒排期（§0.3）：即将开课未备模板 ----
    labels.set("templateUrgent", schoolT("home.templateUrgentTitle"));
    extras.set("templateUrgent", {
      tone: templateUrgent.length === 0 ? "leaf" : "rose",
      minimal: <MinimalBody value={templateUrgent.length} rose={templateUrgent.length > 0} />,
      compact: (
        <CompactBody
          value={templateUrgent.length}
          rose={templateUrgent.length > 0}
          line={
            templateUrgent[0]
              ? `${templateUrgent[0].courseTitle} · ${templateUrgent[0].lectureName}`
              : schoolT("home.templateUrgentEmpty")
          }
        />
      ),
    });
    contents.set(
      "templateUrgent",
      templateUrgent.length === 0 ? (
        <EmptyBody text={schoolT("home.templateUrgentEmpty")} href="/dashboard/courses" linkLabel={schoolT("nav.courses")} />
      ) : (
        <ul className="min-h-0 flex-1 divide-y overflow-hidden">
          {templateUrgent.map((row) => (
            <li key={row.sessionId} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <Link
                href={`/dashboard/courseware/lectures/${row.lectureId}?mode=edit`}
                className="min-w-0 flex-1 truncate font-medium hover:underline"
              >
                {row.courseTitle} · {row.lectureName}
              </Link>
              <span className="shrink-0 text-xs text-muted">{row.classroomName}</span>
              <time className="shrink-0 rounded-full bg-rose/10 px-2 py-0.5 text-xs text-rose">
                {shortFmt.format(new Date(row.scheduledAt))}
              </time>
            </li>
          ))}
        </ul>
      ),
    );

    // ---- 模板完成度（教研） ----
    const progressReady = templateProgress.reduce((sum, row) => sum + row.ready, 0);
    const progressTotal = templateProgress.reduce((sum, row) => sum + row.total, 0);
    labels.set("templateProgress", schoolT("home.templateProgressTitle"));
    extras.set("templateProgress", {
      href: "/dashboard/courses",
      minimal: <MinimalBody value={`${progressReady}/${progressTotal}`} />,
      compact: (
        <CompactBody
          value={`${progressReady}/${progressTotal}`}
          line={
            templateProgress[0]
              ? `${studentsFilterT("grade", { grade: templateProgress[0].grade })} ${templateProgress[0].ready}/${templateProgress[0].total}`
              : schoolT("home.templateProgressEmpty")
          }
        />
      ),
    });
    contents.set(
      "templateProgress",
      templateProgress.length === 0 ? (
        <EmptyBody text={schoolT("home.templateProgressEmpty")} href="/dashboard/courses" linkLabel={schoolT("nav.courses")} />
      ) : (
        <ul className="grid flex-1 content-center gap-1.5">
          {templateProgress.map((row) => (
            <li key={row.grade} className="flex items-center gap-3 text-sm">
              <span className="w-14 shrink-0 truncate text-xs text-muted">{studentsFilterT("grade", { grade: row.grade })}</span>
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-line/40">
                <span
                  className="block h-full rounded-full bg-leaf-deep/60"
                  style={{ width: `${Math.round((row.ready / Math.max(1, row.total)) * 100)}%` }}
                />
              </span>
              <span className="w-14 shrink-0 text-right font-display text-xs tabular-nums">
                {row.ready}/{row.total}
              </span>
            </li>
          ))}
        </ul>
      ),
    );

    // ---- 未点名课次（§0.2 教务） ----
    labels.set("unmarkedAttendance", schoolT("home.unmarkedTitle"));
    extras.set("unmarkedAttendance", {
      tone: unmarkedSessions.length === 0 ? "leaf" : "rose",
      minimal: <MinimalBody value={unmarkedSessions.length} rose={unmarkedSessions.length > 0} />,
      compact: (
        <CompactBody
          value={unmarkedSessions.length}
          rose={unmarkedSessions.length > 0}
          line={
            unmarkedSessions[0]
              ? `${unmarkedSessions[0].classroomName} · ${shortFmt.format(new Date(unmarkedSessions[0].scheduledAt))}`
              : schoolT("home.unmarkedEmpty")
          }
        />
      ),
    });
    contents.set(
      "unmarkedAttendance",
      unmarkedSessions.length === 0 ? (
        <EmptyBody text={schoolT("home.unmarkedEmpty")} />
      ) : (
        <ul className="min-h-0 flex-1 divide-y overflow-hidden">
          {unmarkedSessions.map((row) => (
            <li key={row.sessionId} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <Link href={`/dashboard/classes/${row.classroomId}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                {row.classroomName}
              </Link>
              <span className="max-w-[8rem] shrink-0 truncate text-xs text-muted">{row.title}</span>
              <time className="shrink-0 text-xs text-muted">{shortFmt.format(new Date(row.scheduledAt))}</time>
            </li>
          ))}
        </ul>
      ),
    );

    // ---- 花名册错位（§0.2）：两计数，整贴进班级列表 ----
    const mismatchTotal = rosterMismatch.unlinkedEnrollments + rosterMismatch.orphanMembers;
    labels.set("rosterMismatch", schoolT("home.rosterMismatchTitle"));
    extras.set("rosterMismatch", {
      href: "/dashboard/classes?scope=all",
      cover: true,
      tone: mismatchTotal > 0 ? "rose" : undefined,
      // 2x1 的 full（两计数并排）放得下，只补 1x1 的总数档。
      minimal: <MinimalBody value={mismatchTotal} rose={mismatchTotal > 0} />,
    });
    contents.set(
      "rosterMismatch",
      <div className="flex flex-1 flex-wrap content-center items-center gap-x-5 gap-y-1">
        <div>
          <p className={cn("font-display text-2xl tabular-nums", rosterMismatch.unlinkedEnrollments > 0 && "text-rose")}>
            {rosterMismatch.unlinkedEnrollments}
          </p>
          <p className="text-[11px] text-muted">{schoolT("home.rosterUnlinked")}</p>
        </div>
        <div>
          <p className={cn("font-display text-2xl tabular-nums", rosterMismatch.orphanMembers > 0 && "text-rose")}>
            {rosterMismatch.orphanMembers}
          </p>
          <p className="text-[11px] text-muted">{schoolT("home.rosterOrphan")}</p>
        </div>
      </div>,
    );

    // ---- 跟进工作台入口（§6） ----
    labels.set("followupBoardEntry", schoolT("home.followupBoardTitle"));
    extras.set("followupBoardEntry", {
      href: "/dashboard/followups",
      cover: true,
      minimal: <MinimalBody value={followupCounts.overdue} rose={followupCounts.overdue > 0} />,
    });
    contents.set(
      "followupBoardEntry",
      <div className="flex flex-1 flex-wrap content-center items-center gap-x-5 gap-y-1">
        <div>
          <p className={cn("font-display text-2xl tabular-nums", followupCounts.overdue > 0 && "text-rose")}>{followupCounts.overdue}</p>
          <p className="text-[11px] text-muted">{schoolT("home.followupOverdue")}</p>
        </div>
        <div>
          <p className="font-display text-2xl tabular-nums">{followupCounts.today}</p>
          <p className="text-[11px] text-muted">{schoolT("home.followupToday")}</p>
        </div>
      </div>,
    );

    labels.set("activityToday", schoolT("home.activityTodayTitle"));
    extras.set("activityToday", { href: "/dashboard/activities", cover: true, minimal: <MinimalBody value={activityToday.length} />, compact: <CompactBody value={activityToday.length} line={activityToday[0]?.title ?? schoolT("home.activityTodayEmpty")} /> });
    contents.set("activityToday", activityToday.length===0?<EmptyBody text={schoolT("home.activityTodayEmpty")}/>:<ul className="min-h-0 flex-1 divide-y overflow-hidden">{activityToday.map(row=><li key={row.id} className="flex items-center gap-3 py-2 text-sm"><time className="shrink-0 text-xs text-muted">{timeFmt.format(new Date(row.scheduledAt))}</time><span className="min-w-0 flex-1 truncate font-medium">{row.title}</span><span className="text-xs text-muted">{schoolT("home.activityBooked",{count:row.bookedCount})}</span></li>)}</ul>);
    labels.set("reviewGaps",schoolT("home.reviewGapsTitle"));extras.set("reviewGaps",{href:"/dashboard/classes?scope=teaching",cover:true,minimal:<MinimalBody value={reviewGaps.length} rose={reviewGaps.length>0}/>});contents.set("reviewGaps",reviewGaps.length===0?<EmptyBody text={schoolT("home.reviewGapsEmpty")}/>:<ul className="min-h-0 flex-1 divide-y overflow-hidden">{reviewGaps.map(x=><li key={x.sessionId} className="py-2 text-sm"><Link href={`/dashboard/classes/${x.classroomId}`} className="font-medium hover:underline">{x.classroomName}</Link><span className="ml-2 text-xs text-muted">{x.title}</span></li>)}</ul>);
    labels.set("videoQueue",schoolT("home.videoQueueTitle"));extras.set("videoQueue",{href:"/dashboard/videos",cover:true,minimal:<MinimalBody value={videoQueue.length} rose={videoQueue.length>0}/>});contents.set("videoQueue",videoQueue.length===0?<EmptyBody text={schoolT("home.videoQueueEmpty")}/>:<ul className="min-h-0 flex-1 divide-y overflow-hidden">{videoQueue.map(x=><li key={x.id} className="flex justify-between py-2 text-sm"><span className="font-medium">{x.studentName}</span><time className="text-xs text-muted">{dateFmt.format(new Date(x.submittedAt))}</time></li>)}</ul>);
    labels.set("renewalDue",schoolT("home.renewalDueTitle"));extras.set("renewalDue",{href:"/dashboard/followups?bucket=renewal",cover:true,minimal:<MinimalBody value={renewalDue} rose={renewalDue>0}/>});contents.set("renewalDue",<CompactBody value={renewalDue} rose={renewalDue>0} line={schoolT("home.renewalDueHint")}/>);

    // ---- 制作任务台（教研）：按讲次的课件制作队列，P4H-9 §10-4 ----
    labels.set("coursewareTasks", schoolT("home.coursewareTasksTitle"));
    extras.set("coursewareTasks", {
      href: "/dashboard/courseware",
      minimal: <MinimalBody value={coursewareTasks.length} />,
      compact: (
        <CompactBody
          value={coursewareTasks.length}
          line={coursewareTasks[0] ? `${coursewareTasks[0].courseTitle} · ${coursewareTasks[0].lectureName}` : schoolT("home.coursewareTasksEmpty")}
        />
      ),
    });
    contents.set(
      "coursewareTasks",
      coursewareTasks.length === 0 ? (
        <EmptyBody text={schoolT("home.coursewareTasksEmpty")} href="/dashboard/courseware" linkLabel={schoolT("nav.courseware")} />
      ) : (
        <ul className="min-h-0 flex-1 divide-y overflow-hidden">
          {coursewareTasks.slice(0, 6).map((row) => (
            <li key={row.lectureId} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <Link href={`/dashboard/courseware/lectures/${row.lectureId}?mode=edit`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                {row.courseTitle} · {row.lectureName}
              </Link>
              <span className="shrink-0 text-xs text-muted">{row.pageCount}p</span>
            </li>
          ))}
        </ul>
      ),
    );

    // ---- 学辅任务（P4H-9 §9）：learning_support 责任行按 classroom_staff_assignments 归属 ----
    labels.set("supportTasks", schoolT("home.supportTasksTitle"));
    extras.set("supportTasks", {
      href: "/dashboard/classes?scope=support",
      minimal: <MinimalBody value={supportTasks.length} rose={supportTasks.length > 0} />,
      compact: (
        <CompactBody
          value={supportTasks.length}
          rose={supportTasks.length > 0}
          line={supportTasks[0] ? supportTasks[0].classroomName : schoolT("home.supportTasksEmpty")}
        />
      ),
    });
    contents.set("supportTasks", <SupportTaskList tasks={supportTasks} />);

    const eligible = pickEligible("staff", perms).filter((tile) => tile.key !== "refundQueue" || pendingRefundCount > 0);
    // 管理者且待跟进为空：myFollowUps 不进默认序（留在池里可手动加回，§5.6）。
    const defaultExclude = isManager && myFollowUps.length === 0 ? ["myFollowUps"] : [];
    const merged = mergeTileLayout(eligible, userTiles, staffDefaultOrder(perms), defaultExclude);
    const { items, hidden } = buildTileItems(merged, eligible, labels, contents, extras);

    return (
      <TileWorkspace
        title={schoolT("home.staffTitle")}
        subtitle={subtitle}
        prelude={
          perms.size === 0 ? (
            <section className="rounded-2xl border bg-card p-5">
              <p className="text-sm text-muted">{schoolT("home.emptyStaff")}</p>
            </section>
          ) : undefined
        }
        items={items}
        hidden={hidden}
        readOnly
      />
    );
}
