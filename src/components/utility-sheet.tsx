"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { BookOpen, LayoutDashboard, Menu, NotebookPen, Presentation, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

const items = [
  ["dashboard", LayoutDashboard], ["classroom", Presentation], ["notebook", NotebookPen], ["whiteboard", BookOpen],
] as const;

export function UtilitySheet() {
  const nav = useTranslations("nav");
  const home = useTranslations("home");
  return <Dialog.Root><Dialog.Trigger asChild><button aria-label={home("openDrawer")} className="rounded-full border bg-[var(--card)] p-2.5"><Menu size={18} /></button></Dialog.Trigger><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-40 bg-black/35" /><Dialog.Content className="fixed inset-y-0 right-0 z-50 w-[min(86vw,360px)] border-l bg-[var(--background)] p-7 shadow-2xl"><div className="mb-10 flex items-center justify-between"><Dialog.Title className="text-xl font-semibold">{home("drawer")}</Dialog.Title><Dialog.Close className="rounded-full border p-2"><X size={18} /></Dialog.Close></div><nav className="grid gap-3">{items.map(([slug, Icon]) => <Dialog.Close asChild key={slug}><Link href={`/${slug}`} className="flex items-center gap-3 rounded-2xl border bg-[var(--card)] p-4 transition hover:translate-x-1"><Icon size={20} /><span>{nav(slug)}</span></Link></Dialog.Close>)}</nav></Dialog.Content></Dialog.Portal></Dialog.Root>;
}
