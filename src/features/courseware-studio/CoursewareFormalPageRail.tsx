"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  CoursewareWorkbenchPageRail,
  type CoursewareWorkbenchListItem,
} from "@/features/courseware-doc/CoursewareEditorWorkbench";
import { useRouter } from "@/i18n/navigation";
import { renameCoursewarePageAction } from "./actions";

export interface CoursewareFormalPageRailItem {
  id: string;
  title: string;
  href: string;
  nativeAvailable: boolean;
  adaptedAvailable: boolean;
}

export function CoursewareFormalPageRail({
  items,
  selectedIndex,
  editablePageId,
}: {
  items: CoursewareFormalPageRailItem[];
  selectedIndex: number;
  editablePageId: string | null;
}) {
  const t = useTranslations("coursewareWorkspace");
  const router = useRouter();
  const [titleDrafts, setTitleDrafts] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  const rows: CoursewareWorkbenchListItem[] = items.map((item) => ({
    id: item.id,
    title: titleDrafts[item.id] ?? item.title,
    href: item.href,
    trailing: <span className="flex shrink-0 gap-1" aria-label={t("trackAvailability")}>
      {item.nativeAvailable ? <span className="size-1.5 rounded-full bg-crater" title={t("canvasNative")} /> : null}
      {item.adaptedAvailable ? <span className="size-1.5 rounded-full bg-amber-500" title={t("canvasAdapted")} /> : null}
    </span>,
  }));

  const commitTitle = (item: CoursewareWorkbenchListItem, value: string) => {
    const original = items.find((candidate) => candidate.id === item.id)?.title ?? "";
    const title = value.trim();
    if (title === original) return;
    if (!title) {
      setTitleDrafts((current) => ({ ...current, [item.id]: original }));
      setMessage(t("pageTitleRequired"));
      return;
    }
    startTransition(async () => {
      setMessage(t("pageTitleSaving"));
      const result = await renameCoursewarePageAction({ pageDocId: item.id, title });
      if (!result.ok) {
        setTitleDrafts((current) => ({ ...current, [item.id]: original }));
        setMessage(t("pageTitleSaveFailed", { code: result.code }));
        return;
      }
      setTitleDrafts((current) => ({ ...current, [item.id]: title }));
      setMessage(t("pageTitleSaved"));
      router.refresh();
    });
  };

  return (
    <>
      <CoursewareWorkbenchPageRail
        items={rows}
        selectedIndex={selectedIndex}
        onItemTitleChange={editablePageId ? (item, _index, value) => {
          if (item.id === editablePageId) setTitleDrafts((current) => ({ ...current, [item.id]: value }));
        } : undefined}
        onItemTitleCommit={editablePageId ? (item, _index, value) => {
          if (item.id === editablePageId) commitTitle(item, value);
        } : undefined}
        titleInputLabel={t("renamePage")}
        titleInputDisabled={pending}
      />
      <span className="sr-only" role="status" aria-live="polite">{message}</span>
    </>
  );
}
