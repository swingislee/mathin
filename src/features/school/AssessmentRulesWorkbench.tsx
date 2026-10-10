"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { CalendarDays, Plus, RefreshCw } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DashboardPage, DashboardTableShell, DashboardCommandPanel, DashboardCommandState, DashboardCommandFilters, DashboardCommandActions } from "./dashboard-page";
import { FollowupRecordRow, FollowupTableBody } from "./dashboard-page/FollowupRecordRow";
import { DashboardRowDisclosure } from "./dashboard-page/DashboardRowDisclosure";
import { DashboardInlineEntry } from "./dashboard-page/DashboardInlineEntry";
import { DashboardTablePagination } from "./dashboard-page/DashboardTablePagination";
import { AssessmentRuleEditor, assessmentRuleError } from "./AssessmentRuleEditor";
import { AssessmentTopicEditor } from "./AssessmentTopicEditor";
import { loadAssessmentRulesAction } from "./assessment-rules-actions";
import { editAssessmentRule, newAssessmentRule, ruleMinuteLabel, type AssessmentRule, type AssessmentRulesWorkspace, type AssessmentTopicDefinition, type SaveAssessmentRuleInput } from "./assessment-rules-contract";

type WorkspaceProps = { workspace: AssessmentRulesWorkspace; onSaved: (value: AssessmentRulesWorkspace) => void };

function RuleRow({ rule, workspace, onSaved }: WorkspaceProps & { rule: AssessmentRule }) {
  const t = useTranslations("school.assessmentRules");
  const [expanded, updateExpanded] = useState(false);
  const [visited, setVisited] = useState(false);
  const setExpanded = (open: boolean) => { if (open) setVisited(true); updateExpanded(open); };
  const [pending, setPending] = useState(false);
  const id = `assessment-rule-${rule.id}`;
  const topics = rule.topics.map(topic => workspace.topics.find(item => item.id === topic)?.name ?? topic).join("、");
  return <FollowupRecordRow rowKey={rule.id} active={expanded} expanded={expanded} onExpandedChange={open => { if (!pending) setExpanded(open); }}
    pending={pending} detailsId={id} title={rule.label || t(rule.kind)} colSpan={8} keepMounted={visited} hideTitle
    summary={<>
      <TableCell mobileLabel={t("kind")}><div className="flex items-center gap-1"><DashboardRowDisclosure expanded={expanded} label={t("editRule")} controls={id} onToggle={() => { if (!pending) setExpanded(!expanded); }} /><span>{t(rule.kind)}</span>{rule.label && <span className="text-muted">· {rule.label}</span>}</div></TableCell>
      <TableCell mobileLabel={t("dates")}>{rule.from} – {rule.until}</TableCell>
      <TableCell mobileLabel={t("weekdays")}>{rule.weekdays.length ? rule.weekdays.map(day => t(`day${day}`)).join("、") : t("everyDay")}</TableCell>
      <TableCell mobileLabel={t("time")}>{ruleMinuteLabel(rule.startMinute)}–{ruleMinuteLabel(rule.endMinute)}{rule.durationMinutes ? <span className="ml-1 text-muted">/ {t("minutes", { count: rule.durationMinutes })}</span> : null}</TableCell>
      <TableCell mobileLabel={t("campus")}>{workspace.campuses.find(c => c.id === rule.campusId)?.name || t("allCampuses")}</TableCell>
      <TableCell mobileLabel={t("topics")}>{topics || t("allTopics")}</TableCell>
      <TableCell mobileLabel={t("state")}><span className={rule.enabled ? "text-leaf-deep" : "text-muted"}>{t(rule.enabled ? "enabled" : "disabled")}</span></TableCell>
      <TableCell mobileLabel={t("available")} className="tabular-nums">{rule.kind === "open" ? rule.availableCount : "—"}{rule.bookedCount > 0 && <span className="ml-2 text-muted">{t("bookedCount", { count: rule.bookedCount })}</span>}</TableCell>
    </>}>
    {() => <AssessmentRuleEditor key={rule.updatedAt} initial={editAssessmentRule(rule)} workspace={workspace} onPendingChange={setPending}
      onClose={() => setExpanded(false)} onSaved={data => { onSaved(data); setExpanded(false); }} />}
  </FollowupRecordRow>;
}

function TeacherRules({ teacher, workspace, onSaved, timeZone, now }: WorkspaceProps & {
  teacher: AssessmentRulesWorkspace["teachers"][number]; timeZone: string; now: number;
}) {
  const t = useTranslations("school.assessmentRules");
  const [draft, setDraft] = useState<SaveAssessmentRuleInput | null>(null);
  const [pending, setPending] = useState(false);
  const rules = workspace.rules.filter(rule => rule.teacherId === teacher.id);
  function add(kind: "open" | "exclude") {
    const active = workspace.topics.filter(topic => topic.enabled);
    setDraft(newAssessmentRule(teacher.id, kind, timeZone, now, workspace.campuses.find(c => c.active)?.id ?? null,
      active.length === 1 ? [active[0].id] : []));
  }
  return <div className="min-w-0 space-y-2 py-2">
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant="secondary" disabled={Boolean(draft) || !teacher.canReceive} onClick={() => add("open")}><Plus className="size-3.5" />{t("addOpen")}</Button>
      <Button type="button" size="sm" variant="secondary" disabled={Boolean(draft)} onClick={() => add("exclude")}><Plus className="size-3.5" />{t("addExclude")}</Button>
      {teacher.standaloneCount > 0 && <Link className="text-xs text-muted underline" href="/dashboard/assessments/availability?view=calendar">{t("standaloneCount", { count: teacher.standaloneCount })}</Link>}
      {!teacher.canReceive && <span className="text-xs text-muted">{t("teacherUnavailable")}</span>}
    </div>
    {draft && <DashboardInlineEntry title={t(draft.definition.kind)} closeLabel={t("close")} onClose={() => { if (!pending) setDraft(null); }} pending={pending} autoFocus>
      <AssessmentRuleEditor initial={draft} workspace={workspace} onPendingChange={setPending} onClose={() => setDraft(null)} onSaved={data => { onSaved(data); setDraft(null); }} />
    </DashboardInlineEntry>}
    <Table mobileLayout="stacked"><TableHeader><TableRow>
      {["kind", "dates", "weekdays", "time", "campus", "topics", "state", "available"].map(key => <TableHead key={key}>{t(key)}</TableHead>)}
    </TableRow></TableHeader><FollowupTableBody navigation="tree" onNavigate={() => true}>
      {rules.length ? rules.map(rule => <RuleRow key={rule.id} rule={rule} workspace={workspace} onSaved={onSaved} />)
        : <TableRow><TableCell colSpan={8} className="h-20 text-center text-muted">{t("noRules")}</TableCell></TableRow>}
    </FollowupTableBody></Table>
  </div>;
}

function TeacherRow({ teacher, workspace, onSaved, timeZone, now, visible }: WorkspaceProps & {
  teacher: AssessmentRulesWorkspace["teachers"][number]; timeZone: string; now: number; visible: boolean;
}) {
  const t = useTranslations("school.assessmentRules");
  const [expanded, updateExpanded] = useState(false);
  const [visited, setVisited] = useState(false);
  const setExpanded = (open: boolean) => { if (open) setVisited(true); updateExpanded(open); };
  const rules = workspace.rules.filter(rule => rule.teacherId === teacher.id);
  const id = `assessment-teacher-${teacher.id}`;
  return <FollowupRecordRow rowKey={teacher.id} active={expanded} expanded={expanded && visible} onExpandedChange={setExpanded}
    rowProps={{ hidden: !visible }} detailsId={id} title={teacher.displayName} colSpan={4} keepMounted={visited} hideTitle
    summary={<>
      <TableCell mobileLabel={t("teacher")}><div className="flex items-center gap-1"><DashboardRowDisclosure expanded={expanded} label={t("rulesFor", { name: teacher.displayName })} controls={id} onToggle={() => setExpanded(!expanded)} />{teacher.displayName}</div></TableCell>
      <TableCell mobileLabel={t("open")} className="tabular-nums">{rules.filter(rule => rule.kind === "open" && rule.enabled).length}</TableCell>
      <TableCell mobileLabel={t("exclude")} className="tabular-nums">{rules.filter(rule => rule.kind === "exclude" && rule.enabled).length}</TableCell>
      <TableCell mobileLabel={t("available")} className="tabular-nums">{rules.reduce((sum, rule) => sum + rule.availableCount, 0)}</TableCell>
    </>}>
    {() => <TeacherRules teacher={teacher} workspace={workspace} onSaved={onSaved} timeZone={timeZone} now={now} />}
  </FollowupRecordRow>;
}

function TopicRow({ topic, workspace, onSaved }: WorkspaceProps & { topic: AssessmentTopicDefinition }) {
  const t = useTranslations("school.assessmentRules");
  const [expanded, updateExpanded] = useState(false);
  const [visited, setVisited] = useState(false);
  const setExpanded = (open: boolean) => { if (open) setVisited(true); updateExpanded(open); };
  const [pending, setPending] = useState(false);
  const id = `assessment-topic-${topic.id}`;
  return <FollowupRecordRow rowKey={topic.id} active={expanded} expanded={expanded} onExpandedChange={value => { if (workspace.canManageAll && !pending) setExpanded(value); }}
    pending={pending} detailsId={id} title={topic.name} colSpan={3} keepMounted={visited} hideTitle summary={<>
      <TableCell mobileLabel={t("topicName")}><div className="flex items-center gap-1">{workspace.canManageAll && <DashboardRowDisclosure expanded={expanded} label={t("editTopic")} controls={id} onToggle={() => { if (!pending) setExpanded(!expanded); }} />}{topic.name}</div></TableCell>
      <TableCell mobileLabel={t("topicNameEn")}>{topic.nameEn || "—"}</TableCell><TableCell mobileLabel={t("state")}>{t(topic.enabled ? "enabled" : "disabled")}</TableCell>
    </>}>
    {() => <AssessmentTopicEditor key={topic.updatedAt} topic={topic} onPendingChange={setPending} onClose={() => setExpanded(false)} onSaved={data => { onSaved(data); setExpanded(false); }} />}
  </FollowupRecordRow>;
}

export function AssessmentRulesWorkbench({ initial, initialError, timeZone, now }: {
  initial: AssessmentRulesWorkspace | null; initialError?: string; timeZone: string; now: number;
}) {
  const t = useTranslations("school.assessmentRules");
  const [workspace, setWorkspace] = useState(initial);
  const [view, setView] = useState("rules");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(initialError ? assessmentRuleError(initialError) : "");
  const [newTopic, setNewTopic] = useState(false);
  const [topicPending, setTopicPending] = useState(false);
  const lock = useRef(false);
  const teachers = workspace?.teachers.filter(teacher => teacher.displayName.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) ?? [];
  const pages = Math.max(1, Math.ceil(teachers.length / size));
  const currentPage = Math.min(page, pages);
  const visibleIds = new Set(teachers.slice((currentPage - 1) * size, currentPage * size).map(t => t.id));
  async function reload() {
    if (lock.current) return;
    lock.current = true; setPending(true); setError("");
    try { const result = await loadAssessmentRulesAction(); if (result.ok) setWorkspace(result.data); else setError(assessmentRuleError(result.code)); }
    catch { setError("failed"); } finally { lock.current = false; setPending(false); }
  }
  return <DashboardPage title={t("title")} backHref="/dashboard/assessments" backLabel={t("back")} description={t("description")}
    commandPanel={<DashboardCommandPanel><DashboardCommandState><Tabs value={view} onValueChange={setView}><TabsList>
      <TabsTrigger value="rules">{t("teacherRules")}</TabsTrigger><TabsTrigger value="topics">{t("topics")}</TabsTrigger>
    </TabsList></Tabs></DashboardCommandState><DashboardCommandFilters>{view === "rules" && <Input value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} aria-label={t("searchTeacher")} placeholder={t("searchTeacher")} className="h-8 w-48" />}</DashboardCommandFilters>
      <DashboardCommandActions>{view === "topics" && workspace?.canManageAll && <Button size="sm" disabled={newTopic} onClick={() => setNewTopic(true)}><Plus className="size-4" />{t("addTopic")}</Button>}
        <Link className={buttonVariants({ size: "sm", variant: "ghost" })} title={t("calendar")} aria-label={t("calendar")} href="/dashboard/assessments/availability?view=calendar"><CalendarDays className="size-4" /></Link>
        <Button size="sm" className="size-8 p-0" variant="ghost" title={t("refresh")} aria-label={t("refresh")} disabled={pending} onClick={() => void reload()}><RefreshCw className="size-4" /></Button>
      </DashboardCommandActions></DashboardCommandPanel>}>
    {error && <p role="alert" className="py-2 text-sm text-rose">{t(error)}</p>}
    {workspace && <>
      <div hidden={view !== "rules"} className="space-y-2"><DashboardTableShell><Table mobileLayout="stacked"><TableHeader><TableRow>
        {["teacher", "open", "exclude", "available"].map(key => <TableHead key={key}>{t(key)}</TableHead>)}
      </TableRow></TableHeader><FollowupTableBody navigation="tree" onNavigate={() => true}>
        {workspace.teachers.map(teacher => <TeacherRow key={teacher.id} teacher={teacher} visible={visibleIds.has(teacher.id)} workspace={workspace} onSaved={setWorkspace} timeZone={timeZone} now={now} />)}
        {!teachers.length && <TableRow><TableCell colSpan={4} className="h-24 text-center text-muted">{t("noTeachers")}</TableCell></TableRow>}
      </FollowupTableBody></Table></DashboardTableShell>
        <DashboardTablePagination currentPage={currentPage} totalPages={pages} totalCount={teachers.length} pageSize={size} pageSizes={[20,50,100]} onPageChange={setPage} onPageSizeChange={value => { setSize(value); setPage(1); }} />
      </div>
      <div hidden={view !== "topics"} className="space-y-2">
        {newTopic && <DashboardInlineEntry title={t("addTopic")} closeLabel={t("close")} pending={topicPending} onClose={() => { if (!topicPending) setNewTopic(false); }} autoFocus>
          <AssessmentTopicEditor topic={null} onPendingChange={setTopicPending} onClose={() => setNewTopic(false)} onSaved={data => { setWorkspace(data); setNewTopic(false); }} />
        </DashboardInlineEntry>}
        <DashboardTableShell><Table mobileLayout="stacked"><TableHeader><TableRow><TableHead>{t("topicName")}</TableHead><TableHead>{t("topicNameEn")}</TableHead><TableHead>{t("state")}</TableHead></TableRow></TableHeader>
          <FollowupTableBody onNavigate={() => true}>{workspace.topics.map(topic => <TopicRow key={topic.id} topic={topic} workspace={workspace} onSaved={setWorkspace} />)}</FollowupTableBody>
        </Table></DashboardTableShell><p className="text-xs text-muted">{t("topicVisibility")}</p>
      </div>
    </>}
  </DashboardPage>;
}
