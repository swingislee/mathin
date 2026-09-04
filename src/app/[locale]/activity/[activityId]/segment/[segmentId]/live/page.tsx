import { notFound, redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Compatibility route for links created by the first public-class prototype.
 * On-site work now opens one event run instead of one teaching route per block.
 */
export default async function LegacyPublicClassSegmentLivePage({
  params,
}: {
  params: Promise<{ locale: string; activityId: string; segmentId: string }>;
}) {
  const { locale, activityId, segmentId } = await params;
  setRequestLocale(locale);
  if (!UUID_PATTERN.test(activityId) || !UUID_PATTERN.test(segmentId)) notFound();
  redirect(`/${locale}/activity/${activityId}/live`);
}
