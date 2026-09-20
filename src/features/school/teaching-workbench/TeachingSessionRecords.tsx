import { useTranslations } from "next-intl";
import { useMemo, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Pagination, PaginationContent, PaginationItem, PaginationLink } from "@/components/ui/pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Link } from "@/i18n/navigation";
import { DashboardSection, DashboardTableShell } from "../dashboard-page";
import { withReturnTo } from "../object-workspace/return-target";
import { LearningCheckStatusLegend, LearningCheckStatusMark } from "../LearningCheckStatusMark";
import { ATTENDANCE_STATUS_TONE } from "../attendance-visual";
import type { TeachingRecords } from "./teaching-records-contract";
import { DashboardTablePagination } from "../dashboard-page/DashboardTablePagination";
import { TeachingContactPageSize } from "./TeachingContactPageSize";
import { hasWrittenReview, summarizeTeachingObservations } from "./teaching-learning-summary";
import { TeachingCoverage, TeachingFocus, TeachingPerformance } from "./TeachingObservationCells";
import { AssignmentQuestionSummary } from "../AssignmentQuestionSummary";
import { SessionCommunicationHistory } from "../SessionCommunicationHistory";
import { sessionCommunicationMessages } from "../session-communication-messages";

export function TeachingSessionRecords({ data, locale, timeZone, returnTo, currentHref, pageSize = 20, inline, replay = false, studentWork }: {
  data: TeachingRecords; locale: string; timeZone: string; returnTo: string; currentHref: string; pageSize?: 10 | 20;
  inline?: { onPageChange: (page: number) => void; onPageSizeChange: (size: 10 | 20) => void };
  replay?: boolean;
  studentWork?: ReactNode;
}) {
  const t = useTranslations("school.teachingWorkbench.records");
  const reportT = useTranslations("classroom.report");
  const workT = useTranslations("school.teachingWorkbench");
  const homeworkT = useTranslations("school.homeworkQuestions");
  const formatter = useMemo(() => new Intl.DateTimeFormat(locale, { timeZone, dateStyle: "medium", timeStyle: "short" }), [locale, timeZone]);
  const date = (value: string) => formatter.format(new Date(value));
  const students = new Map(data.students.map(row => [row.id, row.name]));
  const attendance = new Map(data.attendance.map(row => [row.studentId, row]));
  const reviews = new Map(data.reviews.filter(hasWrittenReview).map(row => [row.studentId, row]));
  const results = new Map(data.results.map(row => [`${row.checkId}:${row.studentId}`, row]));
  const observations = useMemo(() => summarizeTeachingObservations(data), [data]);
  const pages = Math.max(1, Math.ceil(data.contactTotal / pageSize));
  const pageHref = (page: number) => {
    const [path, query] = currentHref.split("?");
    const params = new URLSearchParams(query);
    params.set("contactPage", String(page));
    return `${path}?${params}`;
  };
  return <div className={inline ? "space-y-3 [&_section>header]:mb-2" : "space-y-7"}>
    {!replay && !studentWork && <Link className="inline-block text-xs underline underline-offset-4" href={withReturnTo(`/dashboard/sessions/${data.session.id}?stage=post`, currentHref || "/dashboard/classes")}>
      {sessionCommunicationMessages(locale).title}
    </Link>}
    {!inline && <DashboardSection title={`${data.session.classroomName} · ${data.session.title || workT("untitled")}`}>
      <p className="text-sm text-muted">{data.session.scheduledAt && date(data.session.scheduledAt)} · {t(data.session.endedAt ? "ended" : data.session.startedAt ? "started" : "notStarted")}</p>
      <p className="mt-2 text-xs text-muted">{t("readHint")}</p>
      <Link href={returnTo} className="mt-3 inline-block text-sm underline underline-offset-4">{t("back")}</Link>
    </DashboardSection>}
    <DashboardSection title={t("learning")} description={t("learningHint")}>
      <div className="mb-2"><LearningCheckStatusLegend /></div>
      <div className="mb-3 space-y-2 text-xs" data-teaching-observations>
        <div className="flex flex-wrap gap-x-8 gap-y-2"><TeachingPerformance value={observations} /><TeachingCoverage value={observations} reviewCount={reviews.size} /><TeachingFocus value={observations} /></div>
        <p className="text-muted">{workT("observations.basis")} {workT("observations.coverageHint")}</p>
      </div>
      {data.checks.length === 0 && <p className="mb-3 text-sm text-muted">{t("noChecks")}</p>}
      {studentWork ?? <DashboardTableShell className={inline ? "rounded-none border-0" : undefined}><Table className={inline ? "text-xs [&_th]:h-9 [&_th]:px-2 [&_td]:px-2 [&_td]:py-1.5" : undefined} containerClassName={inline ? undefined : "max-h-[65vh] overflow-auto"}>
        <TableHeader className={inline ? "bg-card" : "sticky top-0 z-10 bg-card"}><TableRow>
          <TableHead className="min-w-24">{reportT("student")}</TableHead>
          <TableHead className="min-w-20">{reportT("attendance")}</TableHead>
          {data.checks.map((check, index) => {
            const marked = data.results.filter(result => result.checkId === check.id);
            const supported = marked.filter(result => ["prompted", "imitated", "incomplete"].includes(result.status)).length;
            return <TableHead key={check.id} className="min-w-16 max-w-32 whitespace-normal text-center">{index + 1}. {check.title}
              <p className="mt-0.5 text-[11px] font-normal text-muted">{workT("observations.checkCoverage", { done: marked.length, total: data.students.length, supported })}</p>
            </TableHead>;
          })}
          <TableHead className="min-w-64">{t("reviews")}</TableHead>
        </TableRow></TableHeader>
        <TableBody>{data.students.length === 0 ? <TableRow><TableCell colSpan={3 + data.checks.length}>{reportT("noStudents")}</TableCell></TableRow> : data.students.map(student => {
          const review = reviews.get(student.id);
          const presence = attendance.get(student.id);
          return <TableRow key={student.id}>
            <TableCell className="align-top font-medium">{student.name}</TableCell>
            <TableCell className="align-top text-xs">{presence ? <Badge variant="outline" className={ATTENDANCE_STATUS_TONE[presence.status]}>{reportT(`attendance_${presence.status}`)}</Badge> : reportT("notCaptured")}
              {presence?.note && <p className="mt-1 max-w-48 whitespace-pre-wrap text-muted">{presence.note}</p>}
            </TableCell>
            {data.checks.map(check => {
              const result = results.get(`${check.id}:${student.id}`);
              const status = result?.status ?? "unchecked";
              return <TableCell key={check.id} className="text-center align-top">
                <LearningCheckStatusMark status={status} solid detail={result ? `${student.name} · ${check.title} · ${result.author || t("unknownAuthor")} · ${date(result.markedAt)}` : `${student.name} · ${check.title}`} />
                {result && !inline && <p className="mt-1 text-xs text-muted">{result.author || t("unknownAuthor")}<br />{date(result.markedAt)}</p>}
              </TableCell>;
            })}
            <TableCell className="max-w-lg align-top">
              {review ? <>
                <p className="whitespace-pre-wrap break-words text-sm">{review.comment || t("noComment")}</p>
                <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">{([
                  ["entryScore", review.entryScore], ["exitScore", review.exitScore], ["focus", review.focus],
                  ["participation", review.participation], ["mastery", review.mastery],
                ] as const).filter(([, value]) => value !== null).map(([key, value]) => <div key={key}><dt className="inline">{t(key)}：</dt><dd className="inline tabular-nums">{value}</dd></div>)}</dl>
                <p className="mt-2 text-xs text-muted">{review.author || t("unknownAuthor")} · {date(review.updatedAt)}</p>
              </> : <span className="text-xs text-muted">{t("noReview")}</span>}
            </TableCell>
          </TableRow>;
        })}</TableBody>
      </Table></DashboardTableShell>}
    </DashboardSection>
    <DashboardSection title={homeworkT("overview")}>
      {data.homework === undefined ? <p className="text-xs text-muted">{homeworkT("snapshotUnavailable")}</p>
        : data.homework.length === 0 ? <p className="text-xs text-muted">{homeworkT("noAssignments")}</p>
        : data.homework.map(item => <div key={item.assignment.id} className="mb-3 space-y-2"><div className="flex items-center gap-3"><h4 className="text-xs font-medium">{item.assignment.title}</h4>
          {!replay && <Link prefetch={false} className="text-xs underline underline-offset-4" href={`/dashboard/classes/assignments/${item.assignment.id}`}>{homeworkT(item.canWrite ? "title" : "view")}</Link>}</div>
          <AssignmentQuestionSummary data={item} />
        </div>)}
    </DashboardSection>
    {!studentWork && data.sessionCommunications?.canRead && <DashboardSection title={sessionCommunicationMessages(locale).title}>
      <SessionCommunicationHistory records={data.sessionCommunications.records} locale={locale} timeZone={timeZone} studentNames={Object.fromEntries(students)} />
    </DashboardSection>}
    <DashboardSection title={t("contacts")} description={replay ? workT("replay.contactsHint") : t("contactsHint")}>
      {!data.canReadContacts ? <p className="text-sm text-muted">{t("contactsRestricted")}</p> : <>
        <DashboardTableShell className={inline ? "rounded-none border-0" : undefined}><Table className={inline ? "text-xs [&_th]:h-9 [&_th]:px-2 [&_td]:px-2 [&_td]:py-1.5" : undefined} containerClassName={inline ? undefined : "max-h-[60vh] overflow-auto"}>
          <TableHeader className={inline ? "bg-card" : "sticky top-0 z-10 bg-card"}><TableRow>
            <TableHead>{reportT("student")}</TableHead><TableHead>{t("author")}</TableHead><TableHead>{t("time")}</TableHead><TableHead>{t("content")}</TableHead>
          </TableRow></TableHeader>
          <TableBody>{data.contacts.length === 0 ? <TableRow><TableCell colSpan={4}>{t("noContacts")}</TableCell></TableRow> : data.contacts.map(contact => <TableRow key={contact.id}>
            <TableCell className="align-top">{students.get(contact.studentId)}</TableCell>
            <TableCell className="align-top">{contact.author || t("unknownAuthor")}</TableCell>
            <TableCell className="align-top text-xs text-muted"><p>{contact.occurredOn || t("unknownContactDate")}</p><p className="mt-1">{t("enteredAt", { date: date(contact.createdAt) })}</p></TableCell>
            <TableCell className="min-w-64 max-w-2xl whitespace-pre-wrap break-words align-top">{contact.content}</TableCell>
          </TableRow>)}</TableBody>
        </Table></DashboardTableShell>
        {inline ? <div className="mt-1.5"><DashboardTablePagination currentPage={data.contactPage} totalPages={pages} totalCount={data.contactTotal}
          pageSize={pageSize} pageSizes={[10, 20]} onPageChange={inline.onPageChange}
          onPageSizeChange={size => inline.onPageSizeChange(size === 10 ? 10 : 20)} /></div> : <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted">
          <span>{workT("pagination", { page: data.contactPage, pages, count: data.contactTotal })}</span>
          <TeachingContactPageSize pageSize={pageSize} currentHref={currentHref} />
          <Pagination className="w-auto" aria-label={workT("pages")}><PaginationContent>
            {data.contactPage > 1 && <PaginationItem><PaginationLink asChild><Link href={pageHref(data.contactPage - 1)} className="w-auto px-3">{workT("previousPage")}</Link></PaginationLink></PaginationItem>}
            {data.contactPage < pages && <PaginationItem><PaginationLink asChild><Link href={pageHref(data.contactPage + 1)} className="w-auto px-3">{workT("nextPage")}</Link></PaginationLink></PaginationItem>}
          </PaginationContent></Pagination>
        </div>}
      </>}
    </DashboardSection>
    {data.supportNotes.length > 0 && <DashboardSection title={t("supportNotes")} description={t("supportHint")}>
      <ul className="space-y-4">{data.supportNotes.map(note => <li key={note.id}>
        <p className="text-xs text-muted">{workT.has(`taskKind.${note.kind}`) ? workT(`taskKind.${note.kind}`) : workT("otherTask")} · {t("assignee")}：{note.author || t("unknownAuthor")}
          {note.completedAt && ` · ${date(note.completedAt)}`}</p>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm">{note.note}</p>
      </li>)}</ul>
    </DashboardSection>}
    {!inline && <Link className="inline-block text-sm underline underline-offset-4" href={withReturnTo(`/dashboard/classes/${data.session.classroomId}?tab=students`, currentHref)}>{t("classStudents")}</Link>}
  </div>;
}
