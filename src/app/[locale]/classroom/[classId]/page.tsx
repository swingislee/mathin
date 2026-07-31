import { notFound, redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { getClassroom } from "@/features/classroom/actions";
import { requireUser } from "@/lib/auth";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ClassroomDetailCompatibilityPage({
  params,
}: {
  params: Promise<{ locale: string; classId: string }>;
}) {
  const { locale, classId } = await params;
  setRequestLocale(locale);
  await requireUser(locale);
  if (!UUID_PATTERN.test(classId)) notFound();
  const classroom = await getClassroom(classId);
  if (!classroom) notFound();
  redirect(classroom.myRole === "teacher"
    ? "/" + locale + "/dashboard/classes/" + classId
    : "/" + locale + "/dashboard/learning/classes/" + classId);
}