"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { BookOpen, LayoutDashboard, Lightbulb, LogIn, LogOut, Menu, NotebookPen, PenLine, Presentation, Puzzle, Sprout, Wrench, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { logout } from "@/app/[locale]/(auth)/actions";
import { Input } from "@/components/ui/input";

const publicItems = [
  ["story", BookOpen], ["games", Puzzle], ["minds", Lightbulb], ["terms", Sprout], ["tools", Wrench],
] as const;
const featureItems = [
  ["dashboard", LayoutDashboard], ["classroom", Presentation], ["notebook", NotebookPen], ["whiteboard", PenLine],
] as const;

export function UtilitySheet({ isLoggedIn, locale }: { isLoggedIn: boolean; locale: string }) {
  const nav = useTranslations("nav");
  const home = useTranslations("home");
  const common = useTranslations("common");
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <button aria-label={home("openDrawer")} className="rounded-full border bg-card p-2.5 transition duration-200 hover:-translate-y-0.5"><Menu size={18} /></button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/35" />
        <Dialog.Content className="fixed inset-y-0 right-0 z-50 flex w-[min(86vw,360px)] flex-col border-l bg-paper p-7 shadow-2xl">
          <div className="mb-10 flex items-center justify-between">
            <Dialog.Title className="font-display text-xl">{home("drawer")}</Dialog.Title>
            <Dialog.Close className="rounded-full border p-2"><X size={18} /></Dialog.Close>
          </div>
          <nav aria-label={home("publicSections")} className="grid gap-3">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted">{home("publicSections")}</p>
            {publicItems.map(([slug, Icon]) => (
              <Dialog.Close asChild key={slug}>
                <Link href={`/${slug}`} className="flex items-center gap-3 rounded-2xl border bg-card p-4 transition duration-200 hover:translate-x-1">
                  <Icon size={20} strokeWidth={1.75} />
                  <span>{nav(slug)}</span>
                </Link>
              </Dialog.Close>
            ))}
          </nav>
          {isLoggedIn && (
            <nav aria-label={home("featureSections")} className="mt-7 grid gap-3 border-t border-line pt-6">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted">{home("featureSections")}</p>
              {featureItems.map(([slug, Icon]) => (
                <Dialog.Close asChild key={slug}>
                  <Link href={`/${slug}`} className="flex items-center gap-3 rounded-2xl border bg-card p-4 transition duration-200 hover:translate-x-1">
                    <Icon size={20} strokeWidth={1.75} />
                    <span>{nav(slug)}</span>
                  </Link>
                </Dialog.Close>
              ))}
            </nav>
          )}
          <div className="mt-auto border-t pt-5">
            <div className="mb-4 flex flex-wrap gap-3 text-xs text-muted"><Dialog.Close asChild><Link href="/privacy" className="underline underline-offset-2 hover:text-ink">{common("privacy")}</Link></Dialog.Close><Dialog.Close asChild><Link href="/children-privacy" className="underline underline-offset-2 hover:text-ink">{common("childrenPrivacy")}</Link></Dialog.Close></div>
            {isLoggedIn ? (
              <form action={logout}>
                <Input type="hidden" name="locale" value={locale} />
                <button type="submit" className="flex w-full items-center gap-3 rounded-2xl border border-crater p-4 text-sm transition duration-200 hover:bg-moon/50">
                  <LogOut size={18} strokeWidth={1.75} />
                  <span>{common("logout")}</span>
                </button>
              </form>
            ) : (
              <Dialog.Close asChild>
                <Link href="/login" className="flex items-center gap-3 rounded-2xl border border-crater p-4 text-sm transition duration-200 hover:bg-moon/50">
                  <LogIn size={18} strokeWidth={1.75} />
                  <span>{common("login")}</span>
                </Link>
              </Dialog.Close>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
