import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { AssessmentReportView } from "@/features/school/AssessmentReportView";
import { assessmentReportSchema } from "@/features/school/assessment-workflow-contract";
import { requireAnyPerm } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function AssessmentReportPage({ params }: {
  params: Promise<{ locale: string; registrationId: string; reportId: string }>;
}) {
  const { locale, registrationId, reportId } = await params;
  setRequestLocale(locale);
  await requireAnyPerm(locale, ["review.write", "followup.view"]);
  const supabase = await createClient();
  const { data, error } = await supabase.from("assessment_reports").select("id,version,payload,created_at")
    .eq("id", reportId).eq("registration_id", registrationId).maybeSingle();
  if (error || !data) notFound();
  return <AssessmentReportView report={assessmentReportSchema.parse(data)} locale={locale} />;
}
