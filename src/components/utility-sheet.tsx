"use client";

import { BookOpen, LayoutDashboard, Lightbulb, LogIn, LogOut, Menu, NotebookPen, PenLine, Presentation, Puzzle, Sprout, Wrench } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { logout } from "@/app/[locale]/(auth)/actions";
import { Input } from "@/components/ui/input";
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

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
    <Sheet>
      <SheetTrigger asChild>
        <button aria-label={home("openDrawer")} className="rounded-full border bg-card p-2.5 transition duration-200 hover:-translate-y-0.5"><Menu size={18} /></button>
      </SheetTrigger>
      <SheetContent side="right" closeLabel={home("closeDrawer")} className="flex w-[min(86vw,360px)] flex-col p-7">
        <SheetTitle className="mb-10 text-xl">{home("drawer")}</SheetTitle>
        <nav aria-label={home("publicSections")} className="grid gap-3">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted">{home("publicSections")}</p>
          {publicItems.map(([slug, Icon]) => (
            <SheetClose asChild key={slug}>
              <Link href={`/${slug}`} className="flex items-center gap-3 rounded-2xl border bg-card p-4 transition duration-200 hover:translate-x-1">
                <Icon size={20} strokeWidth={1.75} />
                <span>{nav(slug)}</span>
              </Link>
            </SheetClose>
          ))}
        </nav>
        {isLoggedIn && (
          <nav aria-label={home("featureSections")} className="mt-7 grid gap-3 border-t border-line pt-6">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted">{home("featureSections")}</p>
            {featureItems.map(([slug, Icon]) => (
              <SheetClose asChild key={slug}>
                <Link href={`/${slug}`} className="flex items-center gap-3 rounded-2xl border bg-card p-4 transition duration-200 hover:translate-x-1">
                  <Icon size={20} strokeWidth={1.75} />
                  <span>{nav(slug)}</span>
                </Link>
              </SheetClose>
            ))}
          </nav>
        )}
        <div className="mt-auto border-t pt-5">
          <div className="mb-4 flex flex-wrap gap-3 text-xs text-muted"><SheetClose asChild><Link href="/privacy" className="underline underline-offset-2 hover:text-ink">{common("privacy")}</Link></SheetClose><SheetClose asChild><Link href="/children-privacy" className="underline underline-offset-2 hover:text-ink">{common("childrenPrivacy")}</Link></SheetClose></div>
          {isLoggedIn ? (
            <form action={logout}>
              <Input type="hidden" name="locale" value={locale} />
              <button type="submit" className="flex w-full items-center gap-3 rounded-2xl border border-crater p-4 text-sm transition duration-200 hover:bg-moon/50">
                <LogOut size={18} strokeWidth={1.75} />
                <span>{common("logout")}</span>
              </button>
            </form>
          ) : (
            <SheetClose asChild>
              <Link href="/login" className="flex items-center gap-3 rounded-2xl border border-crater p-4 text-sm transition duration-200 hover:bg-moon/50">
                <LogIn size={18} strokeWidth={1.75} />
                <span>{common("login")}</span>
              </Link>
            </SheetClose>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
