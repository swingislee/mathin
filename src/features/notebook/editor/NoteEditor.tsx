"use client";

import dynamic from "next/dynamic";
import { useLocale } from "next-intl";

const BlockEditor = dynamic(() => import("./BlockEditor").then((module) => module.BlockEditor), {
  ssr: false,
});

export function NoteEditor({ noteId, userId, initialDocument, initialVersion, readOnly = false }: {
  noteId: string;
  userId: string;
  initialDocument: unknown[] | null;
  initialVersion: number;
  readOnly?: boolean;
}) {
  const locale = useLocale();
  // key 必须含 noteId 与 initialVersion：useCreateBlockNote 的选项不随 props 更新，
  // 笔记间导航、冲突后 router.refresh() 拿到新文档时都只能靠重挂载生效。
  return (
    <BlockEditor
      key={`${noteId}:${initialVersion}:${locale}`}
      locale={locale === "zh" ? "zh" : "en"}
      noteId={noteId}
      userId={userId}
      initialDocument={initialDocument}
      initialVersion={initialVersion}
      readOnly={readOnly}
    />
  );
}
