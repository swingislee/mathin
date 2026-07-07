"use client";

import * as Popover from "@radix-ui/react-popover";
import { EmojiPicker } from "frimousse";
import { SmilePlus } from "lucide-react";
import { useLocale } from "next-intl";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { updateNoteMeta } from "../actions";
import { useNotebookStore } from "../store";
import { useNotebookSync } from "../workspace/NotebookSync";

export function TitleField({ noteId }: { noteId: string }) {
  const t = useTranslations("notebook.editor");
  const locale = useLocale();
  const note = useNotebookStore((state) => state.notes[noteId]);
  const patch = useNotebookStore((state) => state.patch);
  const upsert = useNotebookStore((state) => state.upsert);
  const broadcast = useNotebookSync();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleRef = useRef(note?.title ?? "");

  useEffect(() => () => {
    if (timer.current) {
      clearTimeout(timer.current);
      void updateNoteMeta(noteId, { title: titleRef.current }).then((updated) => {
        upsert(updated);
        broadcast({ type: "meta", note: updated });
      });
    }
  }, [broadcast, noteId, upsert]);

  if (!note) return null;

  function scheduleSave(title: string) {
    titleRef.current = title;
    patch(noteId, { title });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      timer.current = null;
      const updated = await updateNoteMeta(noteId, { title });
      upsert(updated);
      broadcast({ type: "meta", note: updated });
    }, 600);
  }

  async function setIcon(icon: string | null) {
    patch(noteId, { icon });
    const updated = await updateNoteMeta(noteId, { icon });
    upsert(updated);
    broadcast({ type: "meta", note: updated });
  }

  return (
    <div>
      <Popover.Root>
        <Popover.Trigger asChild>
          <button type="button" aria-label={t("chooseIcon")} className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full border text-xl hover:bg-moon/40">{note.icon ?? <SmilePlus size={18} className="text-muted" />}</button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content sideOffset={8} align="start" className="z-50 w-72 rounded-2xl border bg-card p-2 text-ink shadow-sm">
            <EmojiPicker.Root locale={locale === "zh" ? "zh" : "en"} onEmojiSelect={({ emoji }) => void setIcon(emoji)} className="flex h-80 flex-col">
              <EmojiPicker.Search placeholder={t("searchEmoji")} className="mb-2 rounded-full border bg-paper px-3 py-2 text-sm outline-none" />
              <EmojiPicker.Viewport className="min-h-0 flex-1 overflow-y-auto">
                <EmojiPicker.Loading className="grid h-full place-items-center text-sm text-muted">{t("loadingEmoji")}</EmojiPicker.Loading>
                <EmojiPicker.Empty className="grid h-full place-items-center text-sm text-muted">{t("emptyEmoji")}</EmojiPicker.Empty>
                <EmojiPicker.List
                  className="select-none pb-2"
                  components={{
                    CategoryHeader: ({ category, ...props }) => <div {...props} className="bg-card px-2 py-1 text-xs text-muted">{category.label}</div>,
                    Row: (props) => <div {...props} className="grid grid-cols-8" />,
                    Emoji: ({ emoji, ...props }) => <button {...props} className="grid size-8 place-items-center rounded-lg text-xl hover:bg-moon/40">{emoji.emoji}</button>,
                  }}
                />
              </EmojiPicker.Viewport>
            </EmojiPicker.Root>
            {note.icon && <button type="button" onClick={() => void setIcon(null)} className="mt-2 w-full rounded-full border px-3 py-1.5 text-sm text-muted">{t("removeIcon")}</button>}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <textarea
        value={note.title}
        onChange={(event) => scheduleSave(event.currentTarget.value)}
        placeholder={t("titlePlaceholder")}
        rows={1}
        maxLength={200}
        className="field-sizing-content min-h-14 w-full resize-none bg-transparent font-display text-4xl leading-tight outline-none placeholder:text-muted/55 md:text-5xl"
      />
    </div>
  );
}
