"use client";

import { FileText, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from "@/components/ui/command";
import { useRouter } from "@/i18n/navigation";
import { useNotebookStore } from "../store";

export function SearchCommand() {
  const t = useTranslations("notebook.search");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const noteMap = useNotebookStore((state) => state.notes);
  const notes = Object.values(noteMap).filter((note) => !note.isArchived);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={t("open")} className="inline-flex items-center gap-2 rounded-full border border-[var(--ws-panel-ink)]/25 p-2 text-xs hover:bg-[var(--ws-sheet)]/10 sm:px-3 sm:py-1.5">
        <Search size={13} /><span className="hidden sm:inline">{t("label")}</span><span className="hidden opacity-60 lg:inline">⌘K</span>
      </button>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder={t("placeholder")} />
        <CommandList>
          <CommandEmpty>{t("empty")}</CommandEmpty>
          <CommandGroup heading={t("group")}>
            {notes.map((note) => (
              <CommandItem key={note.id} value={`${note.title} ${note.id}`} onSelect={() => { setOpen(false); router.push(`/notebook/me/${note.id}`); }}>
                <span aria-hidden>{note.icon ?? <FileText />}</span><span className="truncate">{note.title || t("untitled")}</span><CommandShortcut>↵</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
