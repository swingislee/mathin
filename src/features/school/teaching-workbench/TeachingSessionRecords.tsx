import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Pagination, PaginationContent, PaginationItem, PaginationLink } from "@/components/ui/pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Link } from "@/i18n/navigation";
import { DashboardSection, DashboardTableShell } from "../dashboard-page";
import { withReturnTo } from "../object-workspace/return-target";
import { LEARNING_CHECK_STATUS_STYLE } from "../session-learning-visual";
import type { TeachingRecords } from "./teaching-records-contract";
import { TeachingContactPageSize } from "./TeachingContactPageSize";

export async function TeachingSessionRecords({ data, locale, timeZone, returnTo, currentHref, pageSize = 20 }: {
  data: TeachingRecords; locale: string; timeZone: string; returnTo: string; currentHref: string; pageSize?: 10 | 20;
}) {
  const t = await getTranslations("school.teachingWorkbench.records");
  const reportT = await getTranslations("classroom.report");
  const sessionT = await getTranslations("school.session");
  const workT = await getTranslations("school.teachingWorkbench");
  const date = (value: string) => new Intl.DateTimeFormat(locale, { timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  const students = new Map(data.students.map(row => [row.id, row.name]));
  const attendance = new Map(data.attendance.map(row => [row.studentId, row]));
  const reviews = new Map(data.reviews.map(row => [row.studentId, row]));
  const results = new Map(data.results.map(row => [`${row.checkId}:${row.studentId}`, row]));
  const pages = Math.max(1, Math.ceil(data.contactTotal / pageSize));
  const pageHref = (page: number) => {
    const [path, query] = currentHref.split("?");
    const params = new URLSearchParams(query);
    params.set("contactPage", String(page));
    return `${path}?${params}`;
  };
  return <div className="space-y-7">
    <DashboardSection title={`${data.session.classroomName} · ${data.session.title || workT("untitled")}`}>
      <p className="text-sm text-muted">{data.session.scheduledAt && date(data.session.scheduledAt)} · {t(data.session.endedAt ? "ended" : data.session.startedAt ? "started" : "notStarted")}</p>
      <p className="mt-2 text-xs text-muted">{t("readHint")}</p>
      <Link href={returnTo} className="mt-3 inline-block text-sm underline underline-offset-4">{t("back")}</Link>
    </DashboardSection>
    <DashboardSection title={t("learning")} description={t("learningHint")}>
      {data.checks.length === 0 && <p className="mb-3 text-sm text-muted">{t("noChecks")}</p>}
      <DashboardTableShell><Table containerClassName="max-h-[65vh] overflow-auto">
        <TableHeader className="sticky top-0 z-10 bg-card"><TableRow>
          <TableHead className="min-w-24">{reportT("student")}</TableHead>
          <TableHead className="min-w-28">{reportT("attendance")}</TableHead>
          {data.checks.map((check, index) => <TableHead key={check.id} className="min-w-36 max-w-64 whitespace-normal">{index + 1}. {check.title}</TableHead>)}
          <TableHead className="min-w-64">{t("reviews")}</TableHead>
        </TableRow></TableHeader>
        <TableBody>{data.students.length === 0 ? <TableRow><TableCell colSpan={3 + data.checks.length}>{reportT("noStudents")}</TableCell></TableRow> : data.students.map(student => {
          const review = reviews.get(student.id);
          const presence = attendance.get(student.id);
          return <TableRow key={student.id}>
            <TableCell className="align-top font-medium">{student.name}</TableCell>
            <TableCell className="align-top text-xs">{presence ? reportT(`attendance_${presence.status}`) : reportT("notCaptured")}
              {presence?.note && <p className="mt-1 max-w-48 whitespace-pre-wrap text-muted">{presence.note}</p>}
            </TableCell>
            {data.checks.map(check => {
              const result = results.get(`${check.id}:${student.id}`);
              const status = result?.status ?? "unchecked";
              return <TableCell key={check.id} className="align-top">
                <Badge variant="outline" className={LEARNING_CHECK_STATUS_STYLE[status].icon}>{sessionT(`learningStatus_${status}`)}</Badge>
                {result && <p className="mt-1 text-xs text-muted">{result.author || t("unknownAuthor")}<br />{date(result.markedAt)}</p>}
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
      </Table></DashboardTableShell>
    </DashboardSection>
    <DashboardSection title={t("contacts")} description={t("contactsHint")}>
      {!data.canReadContacts ? <p className="text-sm text-muted">{t("contactsRestricted")}</p> : <>
        <DashboardTableShell><Table containerClassName="max-h-[60vh] overflow-auto">
          <TableHeader className="sticky top-0 z-10 bg-card"><TableRow>
            <TableHead>{reportT("student")}</TableHead><TableHead>{t("author")}</TableHead><TableHead>{t("time")}</TableHead><TableHead>{t("content")}</TableHead>
          </TableRow></TableHeader>
          <TableBody>{data.contacts.length === 0 ? <TableRow><TableCell colSpan={4}>{t("noContacts")}</TableCell></TableRow> : data.contacts.map(contact => <TableRow key={contact.id}>
            <TableCell className="align-top">{students.get(contact.studentId)}</TableCell>
            <TableCell className="align-top">{contact.author || t("unknownAuthor")}</TableCell>
            <TableCell className="align-top text-xs text-muted">{contact.occurredOn || date(contact.createdAt)}</TableCell>
            <TableCell className="min-w-64 max-w-2xl whitespace-pre-wrap break-words align-top">{contact.content}</TableCell>
          </TableRow>)}</TableBody>
        </Table></DashboardTableShell>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted">
          <span>{workT("pagination", { page: data.contactPage, pages, count: data.contactTotal })}</span>
          <TeachingContactPageSize pageSize={pageSize} currentHref={currentHref} />
          <Pagination className="w-auto" aria-label={workT("pages")}><PaginationContent>
            {data.contactPage > 1 && <PaginationItem><PaginationLink asChild><Link href={pageHref(data.contactPage - 1)} className="w-auto px-3">{workT("previousPage")}</Link></PaginationLink></PaginationItem>}
            {data.contactPage < pages && <PaginationItem><PaginationLink asChild><Link href={pageHref(data.contactPage + 1)} className="w-auto px-3">{workT("nextPage")}</Link></PaginationLink></PaginationItem>}
          </PaginationContent></Pagination>
        </div>
      </>}
    </DashboardSection>
    {data.supportNotes.length > 0 && <DashboardSection title={t("supportNotes")} description={t("supportHint")}>
      <ul className="space-y-4">{data.supportNotes.map(note => <li key={note.id}>
        <p className="text-xs text-muted">{workT.has(`taskKind.${note.kind}`) ? workT(`taskKind.${note.kind}`) : workT("otherTask")} · {t("assignee")}：{note.author || t("unknownAuthor")}
          {note.completedAt && ` · ${date(note.completedAt)}`}</p>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm">{note.note}</p>
      </li>)}</ul>
    </DashboardSection>}
    <Link className="inline-block text-sm underline underline-offset-4" href={withReturnTo(`/dashboard/classes/${data.session.classroomId}?tab=students`, currentHref)}>{t("classStudents")}</Link>
  </div>;
}
