"use client";

import { useEffect, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { LoaderCircle } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Link, useRouter } from "@/i18n/navigation";
import { newId } from "@/lib/uuid";
import { STUDENT_360_REFRESH_EVENT } from "./student-360-contract";
import { CONTACT_CHANNELS, CONTACT_ROUTES, classScheduleLabel, enrollmentErrorKey, type ActivityEnrollmentContext, type EnrollmentSourceRef, type EnrollmentWorkflowOptions } from "./enrollment-workflow-contract";
import { confirmActivityEnrollmentAction, getActivityEnrollmentContextAction, getEnrollmentWorkflowOptionsAction, savePostActivityContactAction } from "./enrollment-workflow-actions";
import { LeadIdentityControl } from "./LeadIdentityControl";
import { FollowupChoice } from "./dashboard-page/FollowupChoice";
import type { LeadStatus } from "./lead-contract";


export function PostActivityHandoff({ source, initialContext, onSaved }: {
  source: EnrollmentSourceRef; initialContext?: ActivityEnrollmentContext; onSaved?: (context: ActivityEnrollmentContext) => void;
}) {
  const t = useTranslations("school.enrollmentWorkflow");
  const [context, setContext] = useState(initialContext ?? null);
  const [acceptedInitialContext, setAcceptedInitialContext] = useState(initialContext);
  if (initialContext !== acceptedInitialContext) {
    setAcceptedInitialContext(initialContext);
    if (initialContext) setContext(initialContext);
  }
  const [error, setError] = useState("");
  const [loading, startLoading] = useTransition();
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (initialContext && version === 0) return;
    let active = true;
    startLoading(async () => {
      const result = await getActivityEnrollmentContextAction({ registrationId: source.registrationId, invitationId: source.invitationId });
      if (!active) return;
      if (result.ok) { setContext(result.data); setError(""); }
      else setError(result.code);
    });
    return () => { active = false; };
  }, [source.registrationId, source.invitationId, version, initialContext]);
  const saved = (next: ActivityEnrollmentContext) => { setContext(next); onSaved?.(next); };
  if (!context) return <div className="py-4 text-xs text-muted" aria-live="polite">
    {loading ? <span className="flex items-center gap-2"><LoaderCircle className="size-4 animate-spin" />{t("loading")}</span> : t(enrollmentErrorKey(error))}
    {!loading ? <Button size="sm" variant="ghost" onClick={() => setVersion((value) => value + 1)}>{t("retry")}</Button> : null}
  </div>;
  if (error) return <p role="alert" className="text-xs text-rose">{t(enrollmentErrorKey(error))}</p>;
  if (!context.eligible) return <p className="py-3 text-xs text-muted">{t("notCompleted")}</p>;
  return <HandoffEditor context={context} onSaved={saved} reload={() => setVersion((value) => value + 1)} />;
}

function HandoffEditor({ context, onSaved, reload }: { context: ActivityEnrollmentContext; onSaved: (context: ActivityEnrollmentContext) => void; reload: () => void }) {
  const t = useTranslations("school.enrollmentWorkflow");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startSaving] = useTransition();
  const [channel, setChannel] = useState<(typeof CONTACT_CHANNELS)[number]>(context.contacts[0]?.channel ?? "phone");
  const [outcome, setOutcome] = useState<"connected" | "unreachable">("connected");
  const [route, setRoute] = useState<(typeof CONTACT_ROUTES)[number]>(context.route ?? "continue_follow_up");
  const [note, setNote] = useState("");
  const [nextAt, setNextAt] = useState(() => context.contacts[0]?.nextContactAt ? new Date(new Date(context.contacts[0].nextContactAt).getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 16) : "");
  const sourceDefaults = {
    channel: context.contacts[0]?.channel ?? "phone",
    route: context.route ?? "continue_follow_up",
    nextAt: context.contacts[0]?.nextContactAt ? new Date(new Date(context.contacts[0].nextContactAt).getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 16) : "",
  };
  const [acceptedDefaults, setAcceptedDefaults] = useState(sourceDefaults);
  if (sourceDefaults.channel !== acceptedDefaults.channel || sourceDefaults.route !== acceptedDefaults.route || sourceDefaults.nextAt !== acceptedDefaults.nextAt) {
    setChannel((current) => current === acceptedDefaults.channel ? sourceDefaults.channel : current);
    setRoute((current) => current === acceptedDefaults.route ? sourceDefaults.route : current);
    setNextAt((current) => current === acceptedDefaults.nextAt ? sourceDefaults.nextAt : current);
    setAcceptedDefaults(sourceDefaults);
  }
  const [requestId, setRequestId] = useState(() => newId());
  const [enrolling, setEnrolling] = useState(false);
  const formatAt = (value: string) => new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Shanghai" }).format(new Date(value));
  const saveContact = () => startSaving(async () => {
    const result = await savePostActivityContactAction({
      registrationId: context.registrationId, requestId, channel, outcome, route, note,
      nextContactAt: nextAt && route !== "closed" ? new Date(`${nextAt}+08:00`).toISOString() : null,
    });
    if (!result.ok) { toast.error(t(enrollmentErrorKey(result.code))); return; }
    onSaved(result.data); setNote(""); setRequestId(newId()); toast.success(t("contactSaved")); window.dispatchEvent(new Event(STUDENT_360_REFRESH_EVENT)); router.refresh();
  });
  return <div className="space-y-4" onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && context.canContact && !pending) { event.preventDefault(); saveContact(); } }}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1 text-xs leading-5">
        <p className="font-medium text-ink">{context.name} · {context.activityTitle}</p>
        {context.recommendation ? <p className="text-muted">{t("recommendation")}: {context.recommendation}</p> : null}
        {context.enrollmentId ? <p className="text-leaf-deep">{t("enrolledResult", { course: context.courseTitle ?? "", term: context.termName ?? "", placement: context.classroomName || t("pendingPlacement") })}</p> : null}
      </div>
      {context.canEnroll && !context.enrollmentId ? <Button size="sm" onClick={() => setEnrolling(true)}>{t("enroll")}</Button> : null}
      {context.enrollmentId && context.canEnroll ? <Link className={buttonVariants({ size: "sm", variant: "secondary" })} href={`/dashboard/followups/enrollments?term=${context.termId}&student=${context.studentId}`}>{t("openPlacement")}</Link> : null}
    </div>
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(12rem,0.8fr)]">
      {context.canContact ? <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <FollowupChoice label={t("channel")} value={channel} disabled={pending} onValueChange={(value) => setChannel(value as typeof channel)} options={CONTACT_CHANNELS.map((value) => ({ value, label: t(`channel_${value}`) }))} />
          <FollowupChoice label={t("outcome")} value={outcome} disabled={pending} onValueChange={(value) => setOutcome(value as typeof outcome)} options={[{ value: "connected", label: t("connected"), tone: "healthy" }, { value: "unreachable", label: t("unreachable"), tone: "unhealthy" }]} />
        </div>
        <Textarea aria-label={t("contactNote")} placeholder={t("contactPlaceholder")} rows={3} value={note} maxLength={2000} disabled={pending} onChange={(event) => setNote(event.target.value)} />
        <div className="grid gap-2 sm:grid-cols-2">
          <FollowupChoice label={t("nextStep")} value={route} disabled={pending} onValueChange={(value) => setRoute(value as typeof route)} options={CONTACT_ROUTES.filter((value) => value !== "enrollment_pending" || route === value).map((value) => ({ value, label: t(`route_${value}`), tone: value === "closed" ? "unhealthy" : value === "continue_follow_up" ? "healthy" : "attention" }))} />
          {route !== "closed" ? <div className="space-y-1"><Label className="text-xs text-muted" htmlFor={`next-contact-${context.registrationId}`}>{t("nextContact")}</Label><DateTimePicker id={`next-contact-${context.registrationId}`} mode="datetime" value={nextAt} onValueChange={setNextAt} disabled={pending} /></div> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2"><Button size="sm" variant="secondary" onClick={saveContact} disabled={pending}>{pending ? t("saving") : t("saveContact")}</Button><kbd className="text-[11px] text-muted">Ctrl ↵</kbd></div>
      </div> : null}
      <div className="space-y-2 xl:border-l xl:border-line xl:pl-4">
        <p className="text-xs font-medium text-ink">{t("history")}</p>
        <div className="max-h-64 space-y-3 overflow-y-auto text-[11px] leading-5 text-muted">
          {context.contacts.map((contact) => <div key={contact.id}><p>{formatAt(contact.occurredAt)} · {contact.recordedByName} · {t(`channel_${contact.channel}`)} · {t(contact.outcome)}</p>{contact.note ? <p className="whitespace-pre-wrap text-ink">{contact.note}</p> : null}{contact.nextContactAt ? <p>{t("nextAt", { time: formatAt(contact.nextContactAt) })}</p> : null}</div>)}
          {!context.contacts.length ? <p>{context.routeNote || t("noHistory")}</p> : null}
        </div>
      </div>
    </div>
    <Dialog open={enrolling} onOpenChange={setEnrolling}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>{t("enrollFor", { name: context.name })}</DialogTitle><DialogDescription>{t("enrollIntro")}</DialogDescription></DialogHeader>
        {enrolling ? <EnrollmentForm context={context} reload={reload} onSaved={(next) => { onSaved(next); setEnrolling(false); }} /> : null}
      </DialogContent>
    </Dialog>
  </div>;
}

function EnrollmentForm({ context, reload, onSaved }: { context: ActivityEnrollmentContext; reload: () => void; onSaved: (context: ActivityEnrollmentContext) => void }) {
  const t = useTranslations("school.enrollmentWorkflow");
  const locale = useLocale();
  const router = useRouter();
  const [options, setOptions] = useState<EnrollmentWorkflowOptions | null>(null);
  const [error, setError] = useState("");
  const [pending, startSaving] = useTransition();
  const [mode, setMode] = useState("class");
  const [termId, setTermId] = useState("");
  const [grade, setGrade] = useState(context.grade ? String(context.grade) : "all");
  const [classroomId, setClassroomId] = useState("");
  const [courseId, setCourseId] = useState("");
  const [note, setNote] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    void getEnrollmentWorkflowOptionsAction().then((result) => {
      if (!active) return;
      if (result.ok) { setOptions(result.data); setTermId((value) => value || result.data.terms.find((term) => term.isCurrent)?.id || ""); setError(""); }
      else setError(result.code);
    });
    return () => { active = false; };
  }, [revision]);
  if (!context.studentId && context.leadId) return <div className="space-y-3">
    <p className="text-sm text-muted">{t("identityRequired")}</p>
    <LeadIdentityControl lead={{ id: context.leadId, provisionalStudentName: context.name, gradeHint: context.grade, phone: context.phone, status: (context.leadStatus ?? "contacted") as LeadStatus, ownerId: context.ownerId }} onConfirmed={reload} />
  </div>;
  if (!options) return <div className="text-sm text-muted">{error ? t(enrollmentErrorKey(error)) : t("loading")}{error ? <Button variant="ghost" onClick={() => setRevision((value) => value + 1)}>{t("retry")}</Button> : null}</div>;
  const courses = options.courses.filter((course) => grade === "all" || String(course.grade) === grade);
  const classes = options.classrooms.filter((classroom) => classroom.termId === termId && courses.some((course) => course.id === classroom.courseId));
  const selectedClass = options.classrooms.find((classroom) => classroom.id === classroomId);
  const targetCourseId = mode === "class" ? selectedClass?.courseId : courseId;
  const submit = () => startSaving(async () => {
    if (!targetCourseId) return;
    const result = await confirmActivityEnrollmentAction({ registrationId: context.registrationId, courseId: targetCourseId, termId, classroomId: mode === "class" ? classroomId : null, note });
    if (!result.ok) { setError(result.code); toast.error(t(enrollmentErrorKey(result.code))); return; }
    toast.success(t(result.data.classroomName ? "enrolledAssigned" : "enrolledPending")); onSaved(result.data); window.dispatchEvent(new Event(STUDENT_360_REFRESH_EVENT)); router.refresh();
  });
  return <div className="space-y-4">
    <Tabs value={mode} onValueChange={setMode}><TabsList><TabsTrigger value="class">{t("directClass")}</TabsTrigger><TabsTrigger value="course">{t("courseFirst")}</TabsTrigger></TabsList></Tabs>
    <div className="grid grid-cols-2 gap-3">
      <label className="space-y-1 text-xs text-muted"><span>{t("term")}</span><Select value={termId} onValueChange={(value) => { setTermId(value); setClassroomId(""); }} disabled={pending}><SelectTrigger><SelectValue placeholder={t("chooseTerm")} /></SelectTrigger><SelectContent>{options.terms.map((term) => <SelectItem key={term.id} value={term.id}>{term.name}</SelectItem>)}</SelectContent></Select></label>
      <label className="space-y-1 text-xs text-muted"><span>{t("targetGrade")}</span><Select value={grade} onValueChange={(value) => { setGrade(value); setCourseId(""); setClassroomId(""); }} disabled={pending}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{t("allGrades")}</SelectItem>{[...new Set(options.courses.map((course) => course.grade))].sort((a, b) => a - b).map((value) => <SelectItem key={value} value={String(value)}>{t("grade", { grade: value })}</SelectItem>)}</SelectContent></Select></label>
    </div>
    {mode === "class" ? <div className="space-y-2">
      <label className="space-y-1 text-xs text-muted"><span>{t("classroom")}</span><Select value={classroomId} onValueChange={setClassroomId} disabled={pending || !termId}><SelectTrigger><SelectValue placeholder={t("chooseClass")} /></SelectTrigger><SelectContent>{classes.map((classroom) => <SelectItem key={classroom.id} value={classroom.id}>{classroom.name} · {classroom.teacherNames || t("teacherPending")} · {classroom.activeCount}/{classroom.capacity ?? "∞"}</SelectItem>)}</SelectContent></Select></label>
      {!classes.length ? <p className="text-xs text-muted">{t("noClasses")}</p> : null}
      {selectedClass ? <div className="space-y-1 text-xs leading-5 text-muted"><p>{options.courses.find((course) => course.id === selectedClass.courseId)?.title}</p><p>{selectedClass.teacherNames || t("teacherPending")}</p><p>{classScheduleLabel(selectedClass, locale) || t("schedulePending")}</p><p>{t("capacity", { used: selectedClass.activeCount, capacity: selectedClass.capacity ?? "∞" })}</p></div> : null}
    </div> : <label className="block space-y-1 text-xs text-muted"><span>{t("course")}</span><Select value={courseId} onValueChange={setCourseId} disabled={pending}><SelectTrigger><SelectValue placeholder={t("chooseCourse")} /></SelectTrigger><SelectContent>{courses.map((course) => <SelectItem key={course.id} value={course.id}>{course.title}</SelectItem>)}</SelectContent></Select></label>}
    <Textarea aria-label={t("enrollmentNote")} placeholder={t("enrollmentNote")} value={note} maxLength={2000} rows={2} onChange={(event) => setNote(event.target.value)} disabled={pending} />
    {error ? <p role="alert" className="text-xs text-rose">{t(enrollmentErrorKey(error))}</p> : null}
    <DialogFooter><Button onClick={submit} disabled={pending || !termId || !targetCourseId || (mode === "class" && !classroomId)}>{pending ? t("saving") : t(mode === "class" ? "confirmAndAssign" : "confirmPending")}</Button></DialogFooter>
  </div>;
}
