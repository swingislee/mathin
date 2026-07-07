import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { EmptyState } from "@/components/empty-state";
import { SectionShell } from "@/components/section-shell";
import { listWhiteboards } from "@/features/whiteboard/actions";
import { CreateBoardButton, DeleteBoardButton } from "@/features/whiteboard/ListActions";
import { Link } from "@/i18n/navigation";
import { requireUser } from "@/lib/auth";

export default async function WhiteboardListPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireUser(locale);
  const [t, format, boards] = await Promise.all([
    getTranslations("whiteboard.list"),
    getFormatter(),
    listWhiteboards(),
  ]);
  return (
    <SectionShell section="whiteboard" intro={t("intro")} wide>
      <div className="flex justify-end">
        <CreateBoardButton />
      </div>
      {boards.length === 0 ? (
        <EmptyState message={t("empty")} />
      ) : (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {boards.map((board) => (
            <li key={board.id} className="group relative rounded-2xl border border-line p-5 transition-colors hover:border-crater">
              <Link href={`/whiteboard/${board.id}`} className="block">
                <span className="absolute inset-0" aria-hidden />
                <h2 className="truncate font-medium">{board.title || t("untitled")}</h2>
                <p className="mt-2 text-xs text-muted">
                  {t("updatedAt", { date: format.dateTime(new Date(board.updatedAt), { dateStyle: "medium", timeStyle: "short" }) })}
                </p>
              </Link>
              <div className="relative z-10 mt-4 flex justify-end opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                <DeleteBoardButton id={board.id} title={board.title} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionShell>
  );
}
