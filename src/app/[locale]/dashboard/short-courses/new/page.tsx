import { setRequestLocale } from "next-intl/server";
import { requirePerm } from "@/lib/auth";
import { newId } from "@/lib/uuid";
import { listStaffOptions } from "@/features/school/classes";
import { listSchoolTerms } from "@/features/school/courses";
import { getOrganizationTimezoneV2, listActiveRoomOptionsV2 } from "@/features/school/organization-locations";
import { DashboardPage } from "@/features/school/dashboard-page";
import { calendarDayKey } from "@/features/school/schedule";
import { SHORT_COURSES_HREF } from "@/features/school/short-courses/contract";
import { shortCourseMessages } from "@/features/school/short-courses/messages";
import { NewBatchWorkspace } from "@/features/school/short-courses/NewBatchWorkspace";

export default async function NewShortCourseBatchPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requirePerm(locale, "class.create");
  const [teachers, rooms, terms, timeZone] = await Promise.all([listStaffOptions(), listActiveRoomOptionsV2(), listSchoolTerms(), getOrganizationTimezoneV2()]);
  const m = shortCourseMessages(locale);
  return <DashboardPage title={m.newBatch} backHref={SHORT_COURSES_HREF} backLabel={m.back}>
    <NewBatchWorkspace locale={locale} userId={user.id} teachers={teachers} rooms={rooms} terms={terms} timeZone={timeZone} initial={{
      requestId: newId(), topic: m.defaultTopic, name: "", termId: terms.find(term => term.isCurrent)?.id ?? "",
      startsOn: calendarDayKey(new Date(), timeZone), sessionCount: 4, durationMin: 90,
      classes: [{ key: newId(), name: "", level: "beginner", grades: [], teacherId: "", roomId: null, capacity: 20,
        plannedStudents: null, weeklySlots: [{ weekday: 3, time: "17:00" }, { weekday: 6, time: "14:00" }] }],
    }} />
  </DashboardPage>;
}
