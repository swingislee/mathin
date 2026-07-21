import { permanentRedirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { COURSEWARE_STUDIO_PERMS, parseCoursewareTrack } from "@/features/courseware-studio/data";
import { requireAnyPerm } from "@/lib/auth";

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

/** P4I-12 compatibility shell: editing moved to /studio/courseware, browsing to the lecture workspace. */
export default async function LegacyCoursewareWorkbenchRoute({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; lectureId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale, lectureId }, query] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  await requireAnyPerm(locale, COURSEWARE_STUDIO_PERMS);
  const track = parseCoursewareTrack(query.track);
  if (first(query.mode) === "edit") {
    const search = new URLSearchParams({ track });
    const page = first(query.page);
    if (page) search.set("page", page);
    permanentRedirect(`/studio/courseware/${lectureId}?${search.toString()}`);
  }
  permanentRedirect(`/dashboard/curriculum/lectures/${lectureId}?track=${track}`);
}
