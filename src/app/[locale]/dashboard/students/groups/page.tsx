import { redirect } from "next/navigation";

/** 员工组织已并入员工页；保留旧链接。 */
export default async function LegacyStaffGroupsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  redirect(`/${locale}/dashboard/staff?view=organization`);
}
