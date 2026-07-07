import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { TitleField } from "@/features/notebook/editor/TitleField";
import { getNote } from "@/features/notebook/actions";
import { requireUser } from "@/lib/auth";

export default async function NotebookNotePage({ params }: { params: Promise<{ locale: string; noteId: string }> }) {
  const { locale, noteId } = await params;
  setRequestLocale(locale);
  await requireUser(locale);
  const note = await getNote(noteId);
  if (!note || note.isArchived) notFound();
  return (
    <article className="mx-auto min-h-full max-w-3xl px-6 py-12 md:px-10 md:py-16">
      <TitleField noteId={noteId} />
      <div className="mt-10 h-px bg-line" />
    </article>
  );
}
