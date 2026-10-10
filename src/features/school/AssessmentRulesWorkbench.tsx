"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { CalendarDays, Plus, RefreshCw, UsersRound } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DashboardPage, DashboardTableShell, DashboardCommandPanel, DashboardCommandState, DashboardCommandFilters, DashboardCommandActions } from "./dashboard-page";
import { FollowupRecordRow, FollowupTableBody } from "./dashboard-page/FollowupRecordRow";
import { DashboardRowDisclosure } from "./dashboard-page/DashboardRowDisclosure";
import { DashboardInlineEntry } from "./dashboard-page/DashboardInlineEntry";
import { DashboardTablePagination } from "./dashboard-page/DashboardTablePagination";
import { assessmentRuleError } from "./AssessmentRuleEditor";
import { AssessmentInlineRule } from "./AssessmentInlineRule";
import { AssessmentTeacherCalendar } from "./AssessmentTeacherCalendar";
import { AssessmentTopicEditor } from "./AssessmentTopicEditor";
import { loadAssessmentRulesAction } from "./assessment-rules-actions";
import { assessmentRuleApplies, editAssessmentRule, newAssessmentRule, ruleMinuteLabel, type AssessmentRule, type AssessmentRulesWorkspace, type AssessmentTopicDefinition, type SaveAssessmentRuleInput } from "./assessment-rules-contract";

type WorkspaceProps = { workspace: AssessmentRulesWorkspace; onSaved: (value: AssessmentRulesWorkspace) => void };

function SharedRuleSummary({ rule, workspace }: { rule: AssessmentRule; workspace: AssessmentRulesWorkspace }) {
  const t = useTranslations("school.assessmentRules");
  return <div className="flex flex-wrap gap-x-2 gap-y-1 py-1 text-xs text-muted">
    <span>{t("sharedRule")}</span><span>{rule.weekdays.length ? rule.weekdays.map(day => t(`day${day}`)).join("、") : t("everyDay")}</span>
    <span>{ruleMinuteLabel(rule.startMinute)}–{ruleMinuteLabel(rule.endMinute)}</span><span>{rule.from} – {rule.until}</span>
    <span>{rule.topics.map(id => workspace.topics.find(topic => topic.id === id)?.name ?? id).join("、")}</span>
    <span>{workspace.campuses.find(campus => campus.id === rule.campusId)?.name ?? t("allCampuses")}</span>
  </div>;
}

function TeacherRuleCell({ teacher, kind, workspace, onSaved, timeZone, now }: WorkspaceProps & {
  teacher: AssessmentRulesWorkspace["teachers"][number]; kind: "open" | "exclude"; timeZone: string; now: number;
}) {
  const t = useTranslations("school.assessmentRules");
  const [draft, setDraft] = useState<SaveAssessmentRuleInput | null>(null);
  const rules = workspace.rules.filter(rule => rule.kind === kind && assessmentRuleApplies(rule, teacher));
  function add() {
    const active = workspace.topics.filter(topic => topic.enabled);
    setDraft(newAssessmentRule(teacher.id, kind, timeZone, now, workspace.campuses.find(c => c.active)?.id ?? null,
      active.length === 1 ? [active[0].id] : []));
  }
  return <div className="min-w-0 divide-y divide-line/60">
    {rules.filter(rule => rule.teacherId === null && rule.enabled).map(rule => <SharedRuleSummary key={rule.id} rule={rule} workspace={workspace} />)}
    {rules.filter(rule => rule.teacherId === teacher.id).map(rule => <AssessmentInlineRule key={`${rule.id}:${rule.updatedAt}`} initial={editAssessmentRule(rule)} workspace={workspace} onSaved={onSaved} />)}
    {draft ? <AssessmentInlineRule key={draft.id} initial={draft} workspace={workspace} onCancel={() => setDraft(null)} onSaved={data => { onSaved(data); setDraft(null); }} />
      : <Button type="button" size="sm" variant="ghost" disabled={kind === "open" && !teacher.canReceive} onClick={event => { event.stopPropagation(); add(); }}><Plus className="size-3.5" />{t(kind === "open" ? "addOpen" : "addExclude")}</Button>}
  </div>;
}

function TeacherRow({ teacher, workspace, onSaved, timeZone, now, visible, revision, active }: WorkspaceProps & {
  teacher: AssessmentRulesWorkspace["teachers"][number]; timeZone: string; now: number; visible: boolean; revision: number; active: boolean;
}) {
  const t = useTranslations("school.assessmentRules");
  const [expanded, updateExpanded] = useState(false);
  const [visited, setVisited] = useState(false);
  const setExpanded = (open: boolean) => { if (open) setVisited(true); updateExpanded(open); };
  const id = `assessment-teacher-${teacher.id}`;
  return <FollowupRecordRow rowKey={teacher.id} active={expanded} expanded={expanded && visible} onExpandedChange={setExpanded}
    rowProps={{ hidden: !visible }} detailsId={id} title={teacher.displayName} colSpan={3} keepMounted={visited} hideTitle
    summary={<>
      <TableCell mobileLabel={t("teacher")} className="w-40 align-top"><div className="flex items-center gap-1"><DashboardRowDisclosure expanded={expanded} label={t("calendarFor", { name: teacher.displayName })} controls={id} onToggle={() => setExpanded(!expanded)} />{teacher.displayName}</div>
        <div className="pl-7 text-xs text-muted">{teacher.groupIds.map(id => workspace.groups.find(group => group.id === id)?.name).filter(Boolean).join("、")}</div>
        {!teacher.canReceive && <span className="text-xs text-muted">{t("teacherUnavailable")}</span>}
        {teacher.standaloneCount > 0 && <Link className="text-xs text-muted underline" href="/dashboard/assessments/availability?view=calendar">{t("standaloneCount", { count: teacher.standaloneCount })}</Link>}
      </TableCell>
      {(["open", "exclude"] as const).map(kind => <TableCell key={kind} mobileLabel={t(kind)} className="align-top"><TeacherRuleCell teacher={teacher} kind={kind} workspace={workspace} onSaved={onSaved} timeZone={timeZone} now={now} /></TableCell>)}
    </>}>
    {() => <AssessmentTeacherCalendar teacherId={teacher.id} workspace={workspace} timeZone={timeZone} now={now} active={active && expanded && visible} revision={revision} />}
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
  const [group, setGroup] = useState("all"), [teacherFilter, setTeacherFilter] = useState("all");
  const [sharedDraft, setSharedDraft] = useState<SaveAssessmentRuleInput | null>(null);
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(initialError ? assessmentRuleError(initialError) : "");
  const [newTopic, setNewTopic] = useState(false);
  const [topicPending, setTopicPending] = useState(false);
  const lock = useRef(false);
  const teachers = workspace?.teachers.filter(teacher => teacher.displayName.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
    && (group === "all" || teacher.groupIds.includes(group)) && (teacherFilter === "all" || teacher.id === teacherFilter)) ?? [];
  const pages = Math.max(1, Math.ceil(teachers.length / size));
  const currentPage = Math.min(page, pages);
  const visibleIds = new Set(teachers.slice((currentPage - 1) * size, currentPage * size).map(t => t.id));
  const onSaved = (data: AssessmentRulesWorkspace) => { setWorkspace(data); setRevision(value => value+1); };
  function addShared(kind: "open" | "exclude") {
    if (!workspace) return;
    const topics = workspace.topics.filter(topic => topic.enabled);
    const draft = newAssessmentRule(null, kind, timeZone, now, workspace.campuses.find(c => c.active)?.id ?? null, topics.length === 1 ? [topics[0].id] : []);
    if (teacherFilter !== "all") draft.scope = { kind: "teachers", ids: [teacherFilter] };
    else if (group !== "all") draft.scope = { kind: "groups", ids: [group] };
    setSharedDraft(draft);
  }
  async function reload() {
    if (lock.current) return;
    lock.current = true; setPending(true); setError("");
    try { const result = await loadAssessmentRulesAction(); if (result.ok) onSaved(result.data); else setError(assessmentRuleError(result.code)); }
    catch { setError("failed"); } finally { lock.current = false; setPending(false); }
  }
  return <DashboardPage title={t("title")} backHref="/dashboard/assessments" backLabel={t("back")} description={t("description")}
    commandPanel={<DashboardCommandPanel><DashboardCommandState><Tabs value={view} onValueChange={setView}><TabsList>
      <TabsTrigger value="rules">{t("teacherRules")}</TabsTrigger><TabsTrigger value="topics">{t("topics")}</TabsTrigger>
    </TabsList></Tabs></DashboardCommandState><DashboardCommandFilters>{view === "rules" && <>
      <Input value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} aria-label={t("searchTeacher")} placeholder={t("searchTeacher")} className="h-8 w-36" />
      <Select value={group} onValueChange={value => { setGroup(value); setPage(1); }}><SelectTrigger className="h-8 w-36" aria-label={t("byGroup")}><SelectValue /></SelectTrigger><SelectContent>
        <SelectItem value="all">{t("allGroups")}</SelectItem>{workspace?.groups.map(group => <SelectItem key={group.id} value={group.id}>{group.name}</SelectItem>)}
      </SelectContent></Select>
      <Select value={teacherFilter} onValueChange={value => { setTeacherFilter(value); setPage(1); }}><SelectTrigger className="h-8 w-36" aria-label={t("teacherScope")}><SelectValue /></SelectTrigger><SelectContent>
        <SelectItem value="all">{t("allTeachers")}</SelectItem>{workspace?.teachers.map(teacher => <SelectItem key={teacher.id} value={teacher.id}>{teacher.displayName}</SelectItem>)}
      </SelectContent></Select>
    </>}</DashboardCommandFilters>
      <DashboardCommandActions>{view === "topics" && workspace?.canManageAll && <Button size="sm" disabled={newTopic} onClick={() => setNewTopic(true)}><Plus className="size-4" />{t("addTopic")}</Button>}
        <Link className={buttonVariants({ size: "sm", variant: "ghost" })} href="/dashboard/staff?view=organization"><UsersRound className="size-4" />{t("staffGroups")}</Link>
        <Link className={buttonVariants({ size: "sm", variant: "ghost" })} title={t("calendar")} aria-label={t("calendar")} href="/dashboard/assessments/availability?view=calendar"><CalendarDays className="size-4" /></Link>
        <Button size="sm" className="size-8 p-0" variant="ghost" title={t("refresh")} aria-label={t("refresh")} disabled={pending} onClick={() => void reload()}><RefreshCw className="size-4" /></Button>
      </DashboardCommandActions></DashboardCommandPanel>}>
    {error && <p role="alert" className="py-2 text-sm text-rose">{t(error)}</p>}
    {workspace && <>
      <div hidden={view !== "rules"} className="space-y-4">
        {workspace.canManageAll && <section className="space-y-1">
          <div className="flex flex-wrap items-center gap-2"><h2 className="mr-auto text-sm font-medium">{t("sharedRules")}</h2>
            <Button size="sm" variant="ghost" disabled={Boolean(sharedDraft)} onClick={() => addShared("open")}><Plus className="size-3.5" />{t("addSharedOpen")}</Button>
            <Button size="sm" variant="ghost" disabled={Boolean(sharedDraft)} onClick={() => addShared("exclude")}><Plus className="size-3.5" />{t("addSharedExclude")}</Button>
          </div>
          <DashboardTableShell><Table mobileLayout="stacked"><TableHeader><TableRow><TableHead className="w-28">{t("kind")}</TableHead><TableHead>{t("scopeAndRule")}</TableHead></TableRow></TableHeader><TableBody>
            {workspace.rules.filter(rule => rule.teacherId === null).map(rule => <TableRow key={rule.id}><TableCell mobileLabel={t("kind")} className="align-top">{t(rule.kind)}</TableCell>
              <TableCell mobileLabel={t("scopeAndRule")}><AssessmentInlineRule key={rule.updatedAt} initial={editAssessmentRule(rule)} workspace={workspace} onSaved={onSaved} /></TableCell></TableRow>)}
            {sharedDraft && <TableRow><TableCell mobileLabel={t("kind")} className="align-top">{t(sharedDraft.definition.kind)}</TableCell><TableCell mobileLabel={t("scopeAndRule")}>
              <AssessmentInlineRule key={sharedDraft.id} initial={sharedDraft} workspace={workspace} onCancel={() => setSharedDraft(null)} onSaved={data => { onSaved(data); setSharedDraft(null); }} />
            </TableCell></TableRow>}
            {!sharedDraft && !workspace.rules.some(rule => rule.teacherId === null) && <TableRow><TableCell colSpan={2} className="text-xs text-muted">{t("noSharedRules")}</TableCell></TableRow>}
          </TableBody></Table></DashboardTableShell>
        </section>}
        <DashboardTableShell><Table mobileLayout="stacked"><TableHeader><TableRow>
        {["teacher", "open", "exclude"].map(key => <TableHead key={key}>{t(key)}</TableHead>)}
      </TableRow></TableHeader><FollowupTableBody navigation="tree" onNavigate={() => true}>
        {workspace.teachers.map(teacher => <TeacherRow key={teacher.id} teacher={teacher} visible={visibleIds.has(teacher.id)} workspace={workspace} onSaved={onSaved} timeZone={timeZone} now={now} revision={revision} active={view === "rules"} />)}
        {!teachers.length && <TableRow><TableCell colSpan={3} className="h-24 text-center text-muted">{t("noTeachers")} <Link href="/dashboard/staff?view=organization" className="underline">{t("configureStaffFirst")}</Link></TableCell></TableRow>}
      </FollowupTableBody></Table></DashboardTableShell>
        <DashboardTablePagination currentPage={currentPage} totalPages={pages} totalCount={teachers.length} pageSize={size} pageSizes={[20,50,100]} onPageChange={setPage} onPageSizeChange={value => { setSize(value); setPage(1); }} />
      </div>
      <div hidden={view !== "topics"} className="space-y-2">
        {newTopic && <DashboardInlineEntry title={t("addTopic")} closeLabel={t("close")} pending={topicPending} onClose={() => { if (!topicPending) setNewTopic(false); }} autoFocus>
          <AssessmentTopicEditor topic={null} onPendingChange={setTopicPending} onClose={() => setNewTopic(false)} onSaved={data => { onSaved(data); setNewTopic(false); }} />
        </DashboardInlineEntry>}
        <DashboardTableShell><Table mobileLayout="stacked"><TableHeader><TableRow><TableHead>{t("topicName")}</TableHead><TableHead>{t("topicNameEn")}</TableHead><TableHead>{t("state")}</TableHead></TableRow></TableHeader>
          <FollowupTableBody onNavigate={() => true}>{workspace.topics.map(topic => <TopicRow key={topic.id} topic={topic} workspace={workspace} onSaved={onSaved} />)}</FollowupTableBody>
        </Table></DashboardTableShell><p className="text-xs text-muted">{t("topicVisibility")}</p>
      </div>
    </>}
  </DashboardPage>;
}
