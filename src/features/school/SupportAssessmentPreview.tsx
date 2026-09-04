"use client";

import { Fragment, useMemo, useState } from "react";
import { ArrowLeftRight, ChevronDown, ChevronRight, Clock3 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import {
  ACTIVITY_ROUTES,
  type ActivityRouteKind,
  type AssessmentBand,
} from "./activity-workflow-contract";
import {
  DashboardCommandFilters,
  DashboardCommandActions,
  DashboardCommandPanel,
  DashboardCommandState,
  DashboardEmptyCard,
  DashboardPage,
  DashboardTableShell,
} from "./dashboard-page";
import { LearningCheckStatusIcon } from "./LearningCheckStatusIcon";
import { LEARNING_CHECK_STATUS_STYLE } from "./session-learning-visual";
import {
  TEACHER_ASSESSMENT_OUTCOMES,
  type TeacherAssessmentOutcome,
} from "./teacher-assessment-contract";

type SupportQueue = "pending" | "in_progress" | "handled" | "all";
type ContactChannel = "phone" | "wechat" | "in_person";

interface SupportAssessmentNote {
  questionNo: string;
  knowledgePoint: string;
  note: string;
}

interface SupportAssessmentRow {
  id: string;
  name: string;
  grade: string;
  phone: string;
  assessor: string;
  location: string;
  scheduledAt: string;
  updatedAt: string;
  paperTitle: string;
  answeredCount: number;
  questionCount: number;
  score: number | null;
  totalScore: number;
  band: AssessmentBand | null;
  completedAt: string | null;
  teacherObservation: string;
  outcomeCounts: Record<TeacherAssessmentOutcome, number>;
  keyNotes: SupportAssessmentNote[];
  channel: ContactChannel | null;
  familyFeedback: string;
  route: ActivityRouteKind | null;
  followUpClue: string;
}

const QUEUES: SupportQueue[] = ["pending", "in_progress", "handled", "all"];
const CHANNELS: ContactChannel[] = ["phone", "wechat", "in_person"];

const INITIAL_ROWS: SupportAssessmentRow[] = [
  {
    id: "support-assessment-01",
    name: "安安",
    grade: "五年级",
    phone: "138****2601",
    assessor: "王老师",
    location: "南校区",
    scheduledAt: "2026-09-04T09:50:00+08:00",
    updatedAt: "2026-09-04T10:32:00+08:00",
    paperTitle: "爱学习五年级综合测评",
    answeredCount: 19,
    questionCount: 19,
    score: 118,
    totalScore: 150,
    band: "a_plus",
    completedAt: "2026-09-04T10:32:00+08:00",
    teacherObservation: "计算基本功稳定，应用题能找到数量关系；分数意义的语言表达需要进一步巩固。建议先从 A+ 班型试听。",
    outcomeCounts: { explained: 6, independent: 8, prompted: 3, imitated: 2, incomplete: 0 },
    keyNotes: [
      { questionNo: "7", knowledgePoint: "分数的意义", note: "能找到单位 1，解释为什么这样分时需要提示。" },
      { questionNo: "16", knowledgePoint: "行程应用", note: "列式正确，检查习惯不足导致最后一步计算失误。" },
    ],
    channel: "in_person",
    familyFeedback: "",
    route: null,
    followUpClue: "",
  },
  {
    id: "support-assessment-02",
    name: "小满",
    grade: "二年级",
    phone: "159****4072",
    assessor: "陈老师",
    location: "紫辰校区",
    scheduledAt: "2026-09-04T14:00:00+08:00",
    updatedAt: "2026-09-04T14:28:00+08:00",
    paperTitle: "魔法校二年级基础测评",
    answeredCount: 15,
    questionCount: 15,
    score: 76,
    totalScore: 100,
    band: "a",
    completedAt: "2026-09-04T14:28:00+08:00",
    teacherObservation: "口算速度较快，遇到需要两步推理的问题会急着作答。适合先体验强调表达过程的课程。",
    outcomeCounts: { explained: 3, independent: 7, prompted: 3, imitated: 1, incomplete: 1 },
    keyNotes: [
      { questionNo: "10", knowledgePoint: "两步应用题", note: "第一步独立完成，第二步需要老师追问。" },
    ],
    channel: null,
    familyFeedback: "",
    route: null,
    followUpClue: "",
  },
  {
    id: "support-assessment-03",
    name: "木木",
    grade: "一年级",
    phone: "137****1920",
    assessor: "林老师",
    location: "紫辰校区",
    scheduledAt: "2026-09-04T19:20:00+08:00",
    updatedAt: "2026-09-04T19:34:00+08:00",
    paperTitle: "爱学习一年级入学测评",
    answeredCount: 11,
    questionCount: 19,
    score: null,
    totalScore: 150,
    band: null,
    completedAt: null,
    teacherObservation: "",
    outcomeCounts: { explained: 2, independent: 5, prompted: 3, imitated: 1, incomplete: 0 },
    keyNotes: [],
    channel: null,
    familyFeedback: "",
    route: null,
    followUpClue: "",
  },
  {
    id: "support-assessment-04",
    name: "图图",
    grade: "六年级",
    phone: "152****6831",
    assessor: "王老师",
    location: "南校区",
    scheduledAt: "2026-09-03T19:20:00+08:00",
    updatedAt: "2026-09-03T20:06:00+08:00",
    paperTitle: "爱学习六年级综合测评",
    answeredCount: 19,
    questionCount: 19,
    score: 132,
    totalScore: 150,
    band: "s",
    completedAt: "2026-09-03T19:55:00+08:00",
    teacherObservation: "综合能力较强，空间想象和复杂计算表现突出，可以直接衔接高阶班。",
    outcomeCounts: { explained: 10, independent: 7, prompted: 2, imitated: 0, incomplete: 0 },
    keyNotes: [],
    channel: "in_person",
    familyFeedback: "家长认可测评结果，希望尽快确认周末班名额。",
    route: "enrollment_pending",
    followUpClue: "",
  },
  {
    id: "support-assessment-05",
    name: "星星",
    grade: "二年级",
    phone: "180****5519",
    assessor: "陈老师",
    location: "南校区",
    scheduledAt: "2026-09-03T17:30:00+08:00",
    updatedAt: "2026-09-03T18:15:00+08:00",
    paperTitle: "魔法校二年级基础测评",
    answeredCount: 15,
    questionCount: 15,
    score: 84,
    totalScore: 100,
    band: "a_plus",
    completedAt: "2026-09-03T18:02:00+08:00",
    teacherObservation: "数感较好，愿意表达思路；当前时间与已有班型不匹配。",
    outcomeCounts: { explained: 5, independent: 7, prompted: 2, imitated: 1, incomplete: 0 },
    keyNotes: [],
    channel: "wechat",
    familyFeedback: "家长希望周五放学后上课，目前没有合适班型。",
    route: "await_product",
    followUpClue: "有周五班型时微信联系",
  },
];

function queueFor(row: SupportAssessmentRow): Exclude<SupportQueue, "all"> {
  if (!row.completedAt) return "in_progress";
  return row.route ? "handled" : "pending";
}

export function SupportAssessmentPreview({
  locale,
  canSwitchToTeacher = false,
}: {
  locale: string;
  canSwitchToTeacher?: boolean;
}) {
  const t = useTranslations("school.supportAssessment");
  const hubT = useTranslations("school.assessmentHub");
  const assessmentT = useTranslations("school.assessments");
  const teacherT = useTranslations("school.teacherAssessment");
  const sessionT = useTranslations("school.session");
  const [rows, setRows] = useState(INITIAL_ROWS);
  const [queue, setQueue] = useState<SupportQueue>("pending");
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(INITIAL_ROWS[0]?.id ?? null);
  const [retainedId, setRetainedId] = useState<string | null>(null);
  const dateTime = useMemo(() => new Intl.DateTimeFormat(locale, {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }), [locale]);

  const counts = useMemo(() => ({
    pending: rows.filter((row) => queueFor(row) === "pending").length,
    in_progress: rows.filter((row) => queueFor(row) === "in_progress").length,
    handled: rows.filter((row) => queueFor(row) === "handled").length,
    all: rows.length,
  }), [rows]);
  const visibleRows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase(locale);
    return rows.filter((row) => {
      const inQueue = queue === "all" || queueFor(row) === queue || row.id === retainedId;
      if (!inQueue) return false;
      if (!needle) return true;
      return [row.name, row.phone, row.grade, row.assessor, row.teacherObservation]
        .some((value) => value.toLocaleLowerCase(locale).includes(needle));
    });
  }, [locale, query, queue, retainedId, rows]);

  const updateRow = (id: string, update: (row: SupportAssessmentRow) => SupportAssessmentRow) => {
    setRows((current) => current.map((row) => row.id === id
      ? { ...update(row), updatedAt: new Date().toISOString() }
      : row));
  };
  const chooseQueue = (nextQueue: SupportQueue) => {
    setQueue(nextQueue);
    setRetainedId(null);
    setActiveId(rows.find((row) => nextQueue === "all" || queueFor(row) === nextQueue)?.id ?? null);
  };
  const chooseRoute = (row: SupportAssessmentRow, route: ActivityRouteKind) => {
    setRetainedId(row.id);
    updateRow(row.id, (current) => ({ ...current, route: current.route === route ? null : route }));
  };
  const openNextPending = (currentId: string) => {
    const next = rows.find((row) => row.id !== currentId && queueFor(row) === "pending");
    setRetainedId(null);
    setActiveId(next?.id ?? currentId);
  };

  return (
    <DashboardPage
      title={hubT("title")}
      eyebrow={hubT("supportDesk")}
      description={t("intro")}
      meta={t("localPreview")}
      density="compact"
      commandPanel={(
        <DashboardCommandPanel>
          <DashboardCommandState>
            <Tabs value={queue} onValueChange={(value) => chooseQueue(value as SupportQueue)} aria-label={t("queueLabel")}>
              <TabsList className="h-9 p-0.5">
                {QUEUES.map((item) => (
                  <TabsTrigger key={item} value={item} className="h-8 gap-1.5 px-2.5 text-xs">
                    {t(`queue_${item}`)}
                    <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-line/70 px-1.5 text-[10px] leading-5 text-ink">
                      {counts[item]}
                    </span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </DashboardCommandState>
          <DashboardCommandFilters>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-9 min-w-56 max-w-xl flex-1 text-xs"
              placeholder={t("searchPlaceholder")}
              aria-label={t("searchPlaceholder")}
            />
          </DashboardCommandFilters>
          {canSwitchToTeacher ? (
            <DashboardCommandActions>
              <Link
                href="/dashboard/assessments?desk=teacher"
                className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "h-9 px-3 text-xs")}
              >
                <ArrowLeftRight className="size-3.5" />
                {hubT("switchToTeacher")}
              </Link>
            </DashboardCommandActions>
          ) : null}
        </DashboardCommandPanel>
      )}
    >
      {visibleRows.length === 0 ? <DashboardEmptyCard>{t("empty")}</DashboardEmptyCard> : (
        <DashboardTableShell data-support-assessment-workbench>
          <Table className="min-w-[72rem] table-fixed text-xs" containerClassName="max-h-[calc(100dvh-13rem)] overflow-auto">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="sticky left-0 top-0 z-30 h-9 w-56 border-r border-line bg-card px-2">{t("studentColumn")}</TableHead>
                <TableHead className="sticky top-0 z-20 h-9 w-48 bg-card px-2">{t("resultColumn")}</TableHead>
                <TableHead className="sticky top-0 z-20 h-9 bg-card px-2">{t("teacherColumn")}</TableHead>
                <TableHead className="sticky top-0 z-20 h-9 w-48 bg-card px-2">{t("statusColumn")}</TableHead>
                <TableHead className="sticky top-0 z-20 h-9 w-32 bg-card px-2">{t("updatedColumn")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRows.map((row) => {
                const active = row.id === activeId;
                const stage = queueFor(row);
                return (
                  <Fragment key={row.id}>
                    <TableRow
                      aria-expanded={active}
                      aria-selected={active}
                      className={cn("cursor-pointer", active && "bg-moon/10 hover:bg-moon/10")}
                      onClick={() => setActiveId((current) => current === row.id ? null : row.id)}
                      data-support-assessment-row={row.id}
                    >
                      <TableCell
                        className="sticky left-0 z-10 border-r border-line bg-card px-2 py-2"
                        style={active ? { backgroundColor: "color-mix(in srgb, var(--card) 90%, var(--moon))" } : undefined}
                      >
                        <div className="flex min-w-0 items-start gap-2">
                          {active ? <ChevronDown className="mt-0.5 size-3.5 shrink-0 text-muted" /> : <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-muted" />}
                          <div className="min-w-0">
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="truncate font-medium text-ink">{row.name}</span>
                              <span className="shrink-0 text-[11px] text-muted">{row.grade}</span>
                            </div>
                            <p className="mt-0.5 font-mono text-[11px] text-muted">{row.phone}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="px-2 py-2">
                        {row.completedAt && row.score !== null && row.band ? (
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">{t("scoreValue", { score: row.score, total: row.totalScore })}</span>
                            <Badge variant="outline" className="border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300">
                              {teacherT(`band_${row.band}`)}
                            </Badge>
                          </div>
                        ) : (
                          <p className="font-medium tabular-nums text-ink">{t("progressValue", { answered: row.answeredCount, total: row.questionCount })}</p>
                        )}
                        <p className="mt-0.5 truncate text-[11px] text-muted">{row.paperTitle}</p>
                        <p className="mt-0.5 truncate text-[10px] text-muted">
                          {dateTime.format(new Date(row.scheduledAt))} · {row.location} · {row.assessor}
                        </p>
                      </TableCell>
                      <TableCell className="px-2 py-2">
                        <p className={cn("line-clamp-2 leading-5", row.teacherObservation ? "text-ink" : "text-muted")}>
                          {row.teacherObservation || t("teacherWorking")}
                        </p>
                      </TableCell>
                      <TableCell className="px-2 py-2">
                        <SupportStageBadge row={row} stage={stage} />
                      </TableCell>
                      <TableCell className="px-2 py-2 text-[11px] tabular-nums text-muted">
                        {dateTime.format(new Date(row.updatedAt))}
                      </TableCell>
                    </TableRow>

                    {active ? (
                      <TableRow className="bg-moon/5 hover:bg-moon/5" data-support-assessment-detail={row.id}>
                        <TableCell colSpan={5} className="p-0">
                          {!row.completedAt ? (
                            <div className="flex min-h-28 items-center gap-3 px-5 py-4">
                              <Clock3 className="size-5 shrink-0 text-yellow-600" />
                              <div>
                                <p className="font-medium text-ink">{t("waitingTeacher")}</p>
                                <p className="mt-1 text-xs leading-5 text-muted">{t("autoHandoff")}</p>
                              </div>
                            </div>
                          ) : (
                            <div className="grid min-w-0 xl:grid-cols-[1.15fr_1fr_1fr]">
                              <section className="min-w-0 border-b border-line/70 p-4 xl:border-b-0 xl:border-r">
                                <h3 className="text-xs font-medium text-ink">{t("teacherEvidence")}</h3>
                                <p className="mt-2 text-xs leading-5 text-ink">{row.teacherObservation}</p>
                                <div className="mt-3 flex flex-wrap gap-1">
                                  {TEACHER_ASSESSMENT_OUTCOMES.map((status) => {
                                    const count = row.outcomeCounts[status];
                                    if (count === 0) return null;
                                    return (
                                      <Badge
                                        key={status}
                                        variant="outline"
                                        className={cn(
                                          "gap-1 px-2 py-1 text-[10px]",
                                          LEARNING_CHECK_STATUS_STYLE[status].card,
                                          LEARNING_CHECK_STATUS_STYLE[status].icon,
                                        )}
                                      >
                                        <LearningCheckStatusIcon status={status} size={12} />
                                        {sessionT(`learningStatusShort_${status}`)} {count}
                                      </Badge>
                                    );
                                  })}
                                </div>
                                <h4 className="mt-4 text-[11px] font-medium text-muted">{t("keyNotes")}</h4>
                                {row.keyNotes.length > 0 ? (
                                  <ul className="mt-1 divide-y divide-line/70">
                                    {row.keyNotes.map((note) => (
                                      <li key={`${row.id}:${note.questionNo}`} className="py-2 text-[11px] leading-5">
                                        <span className="font-medium text-ink">{t("questionNote", { question: note.questionNo, point: note.knowledgePoint })}</span>
                                        <span className="ml-2 text-muted">{note.note}</span>
                                      </li>
                                    ))}
                                  </ul>
                                ) : <p className="mt-1 text-[11px] text-muted">{t("noKeyNotes")}</p>}
                              </section>

                              <section className="min-w-0 border-b border-line/70 p-4 xl:border-b-0 xl:border-r">
                                <h3 className="text-xs font-medium text-ink">{t("familyConversation")}</h3>
                                <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label={t("channelLabel")}>
                                  {CHANNELS.map((channel) => (
                                    <Button
                                      key={channel}
                                      type="button"
                                      size="sm"
                                      variant={row.channel === channel ? "primary" : "secondary"}
                                      className="h-8 px-2.5 text-[11px]"
                                      aria-pressed={row.channel === channel}
                                      onClick={() => updateRow(row.id, (current) => ({ ...current, channel }))}
                                    >
                                      {t(`channel_${channel}`)}
                                    </Button>
                                  ))}
                                </div>
                                <label className="mt-3 block space-y-1 text-[11px] text-muted">
                                  <span>{t("familyFeedback")}</span>
                                  <Textarea
                                    value={row.familyFeedback}
                                    rows={4}
                                    maxLength={2_000}
                                    className="min-h-24 resize-y text-xs leading-5 text-ink"
                                    placeholder={t("familyFeedbackPlaceholder")}
                                    onChange={(event) => updateRow(row.id, (current) => ({ ...current, familyFeedback: event.target.value }))}
                                  />
                                </label>
                              </section>

                              <section className="min-w-0 p-4">
                                <h3 className="text-xs font-medium text-ink">{t("outcomeTitle")}</h3>
                                <p className="mt-1 text-[11px] leading-5 text-muted">{t("outcomeHint")}</p>
                                <div className="mt-2 grid grid-cols-2 gap-1.5" role="group" aria-label={t("outcomeTitle")}>
                                  {ACTIVITY_ROUTES.map((route) => (
                                    <Button
                                      key={route}
                                      type="button"
                                      size="sm"
                                      variant={row.route === route ? "primary" : "secondary"}
                                      className="min-h-9 h-auto justify-start whitespace-normal px-2.5 py-1.5 text-left text-[11px] leading-4"
                                      aria-pressed={row.route === route}
                                      onClick={() => chooseRoute(row, route)}
                                    >
                                      {assessmentT(`route_${route}`)}
                                    </Button>
                                  ))}
                                </div>
                                {(row.route === "continue_follow_up" || row.route === "await_product") ? (
                                  <label className="mt-3 block space-y-1 text-[11px] text-muted">
                                    <span>{t("followUpClue")}</span>
                                    <Input
                                      value={row.followUpClue}
                                      maxLength={300}
                                      className="h-9 text-xs text-ink"
                                      placeholder={t("followUpCluePlaceholder")}
                                      onChange={(event) => updateRow(row.id, (current) => ({ ...current, followUpClue: event.target.value }))}
                                    />
                                  </label>
                                ) : null}
                                <p className="mt-3 text-[11px] leading-5 text-muted">
                                  {row.route ? assessmentT(`routeHint_${row.route}`) : assessmentT("routePendingHint")}
                                </p>
                                {retainedId === row.id && row.route ? (
                                  <p className="mt-2 text-[11px] leading-5 text-leaf-deep">{t("retainedAfterRoute")}</p>
                                ) : null}
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="secondary"
                                  className="mt-3 h-8 px-2.5 text-[11px]"
                                  disabled={!rows.some((candidate) => candidate.id !== row.id && queueFor(candidate) === "pending")}
                                  onClick={() => openNextPending(row.id)}
                                >
                                  {t("nextPending")}
                                </Button>
                              </section>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </DashboardTableShell>
      )}
    </DashboardPage>
  );

  function SupportStageBadge({
    row,
    stage,
  }: {
    row: SupportAssessmentRow;
    stage: Exclude<SupportQueue, "all">;
  }) {
    if (stage === "in_progress") return <Badge variant="outline" className="border-yellow-500/40 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300">{t("stageInProgress")}</Badge>;
    if (row.route) return <Badge variant="secondary">{assessmentT(`route_${row.route}`)}</Badge>;
    if (row.familyFeedback) return <Badge variant="outline" className="border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300">{t("stageContacting")}</Badge>;
    return <Badge variant="outline" className="border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300">{t("stagePending")}</Badge>;
  }
}
