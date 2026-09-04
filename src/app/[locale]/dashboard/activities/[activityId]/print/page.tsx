import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  PUBLIC_CLASS_PRINT_KINDS,
  PublicClassPrintView,
  type PublicClassPrintKind,
} from "@/features/school/PublicClassPrintView";
import { getPublicClassWorkbench } from "@/features/school/public-class";
import { DashboardPage } from "@/features/school/dashboard-page";
import { requireAnyPerm } from "@/lib/auth";

const PUBLIC_CLASS_PERMISSIONS = ["activity.register", "review.write", "followup.view"] as const;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function PublicClassPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; activityId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale, activityId }, query] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  await requireAnyPerm(locale, PUBLIC_CLASS_PERMISSIONS);
  const [data, t] = await Promise.all([
    getPublicClassWorkbench(activityId),
    getTranslations("school.publicClass"),
  ]);
  if (!data) notFound();
  const requestedKind = first(query.kind);
  const kind: PublicClassPrintKind = PUBLIC_CLASS_PRINT_KINDS.includes(requestedKind as PublicClassPrintKind)
    ? requestedKind as PublicClassPrintKind
    : "signin";
  const requestedSegment = first(query.segment);
  const segment = data.segments.find((item) => item.id === requestedSegment) ?? data.segments[0];
  if (!segment) notFound();
  return <DashboardPage title={t("printPreviewTitle")} description={t("printPreviewDescription")}>
    <PublicClassPrintView data={data} locale={locale} kind={kind} segment={segment} />
  </DashboardPage>;
}
