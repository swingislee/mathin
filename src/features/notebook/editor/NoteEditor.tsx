"use client";

import dynamic from "next/dynamic";
import { useLocale } from "next-intl";

const BlockEditor = dynamic(() => import("./BlockEditor").then((module) => module.BlockEditor), {
  ssr: false,
});

export function NoteEditor({ noteId, userId, initialDocument, initialVersion }: {
  noteId: string;
  userId: string;
  initialDocument: unknown[] | null;
  initialVersion: number;
}) {
  const locale = useLocale();
  return (
    <BlockEditor
      key={locale}
      locale={locale === "zh" ? "zh" : "en"}
      noteId={noteId}
      userId={userId}
      initialDocument={initialDocument}
      initialVersion={initialVersion}
    />
  );
}
