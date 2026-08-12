import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import type { SpatialPageDoc } from "@/features/spatial-math/domain/page-schema";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { CoursewareTrack, StudioPageSummary } from "./data";
import { StagePreview } from "./StagePreview";

export async function SpatialStudioViewer({
  lecture,
  track,
  page,
  pages,
  doc,
  lectureWorkspaceHref,
}: {
  lecture: { id: string; no: number; name: string };
  track: CoursewareTrack;
  page: StudioPageSummary;
  pages: StudioPageSummary[];
  doc: SpatialPageDoc;
  lectureWorkspaceHref: string;
}) {
  const t = await getTranslations("coursewareStudio");
  const currentIndex = pages.findIndex((item) => item.id === page.id);
  const href = (target: StudioPageSummary) =>
    `/studio/courseware/${lecture.id}?track=${track}&page=${target.id}`;
  const previous = currentIndex > 0 ? pages[currentIndex - 1] : null;
  const next = currentIndex >= 0 && currentIndex < pages.length - 1 ? pages[currentIndex + 1] : null;

  return (
    <div className="@container flex h-full min-h-0 flex-col bg-card">
      <header className="flex min-h-14 shrink-0 items-center gap-3 border-b border-line px-4">
        <Link href={lectureWorkspaceHref} className={buttonVariants({ variant: "ghost", size: "sm" })}>
          {t("backToLectureWorkspace")}
        </Link>
        <span className="min-w-0 flex-1 truncate text-sm text-ink">
          {t("lectureTitle", { no: lecture.no, name: lecture.name })}
        </span>
        <Badge variant="outline">{page.aspect}</Badge>
        <Badge>{t("spatialPageBadge")}</Badge>
      </header>

      <div className="grid min-h-0 flex-1 @4xl:grid-cols-[17rem_minmax(0,1fr)]">
        <aside className="min-h-0 overflow-y-auto border-r border-line p-3">
          <p className="mb-2 px-2 text-xs font-medium text-muted">{t("pageNavigation")}</p>
          <nav className="space-y-1" aria-label={t("pageNavigation")}>
            {pages.map((item) => (
              <Link
                key={item.id}
                href={href(item)}
                className={cn(
                  "block rounded-lg px-3 py-2 text-sm transition-colors",
                  item.id === page.id ? "bg-moon/55 text-ink" : "text-muted hover:bg-moon/30 hover:text-ink",
                )}
              >
                {item.pageNo}. {item.title}
              </Link>
            ))}
          </nav>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-col p-4">
          <div className="mb-3 rounded-xl border border-line bg-moon/20 px-4 py-3">
            <p className="text-sm font-medium text-ink">{t("spatialReadOnlyTitle")}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted">{t("spatialReadOnlyHint")}</p>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-2xl border border-line bg-paper-lines p-3">
            <StagePreview
              doc={doc}
              bindingUrls={{}}
              stageMode={page.aspect === "4:3" ? "board43" : "natural"}
              className={page.aspect === "4:3"
                ? "h-full! w-auto! max-w-full"
                : "h-auto! w-full! max-h-full"}
            />
          </div>
          <footer className="mt-3 flex items-center justify-between gap-3">
            {previous ? (
              <Link href={href(previous)} className={buttonVariants({ variant: "secondary", size: "sm" })}>
                {t("prevPage")}
              </Link>
            ) : <span />}
            <span className="text-xs text-muted">
              {t("pageIndicator", { current: currentIndex + 1, total: pages.length })}
            </span>
            {next ? (
              <Link href={href(next)} className={buttonVariants({ variant: "secondary", size: "sm" })}>
                {t("nextPage")}
              </Link>
            ) : <span />}
          </footer>
        </main>
      </div>
    </div>
  );
}
