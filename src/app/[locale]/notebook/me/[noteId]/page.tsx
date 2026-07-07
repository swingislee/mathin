import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { TitleField } from "@/features/notebook/editor/TitleField";
import { NoteEditor } from "@/features/notebook/editor/NoteEditor";
import { getNote } from "@/features/notebook/actions";
import { ArchivedBanner } from "@/features/notebook/workspace/ArchivedBanner";
import { requireUser } from "@/lib/auth";

export default async function NotebookNotePage({ params }: { params: Promise<{ locale: string; noteId: string }> }) {
  const { locale, noteId } = await params;
  setRequestLocale(locale);
  const user = await requireUser(locale);
  const note = await getNote(noteId);
  if (!note) notFound();
  // 回收站中的笔记可预览但只读，顶部横幅提供恢复/彻底删除。
  return (
    <>
      {note.isArchived && <ArchivedBanner noteId={noteId} />}
      <article className="mx-auto min-h-full max-w-3xl px-6 py-12 md:px-10 md:py-16">
        <TitleField noteId={noteId} readOnly={note.isArchived} />
        <NoteEditor noteId={noteId} userId={user.id} initialDocument={note.document} initialVersion={note.version} readOnly={note.isArchived} />
      </article>
    </>
  );
}
