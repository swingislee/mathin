import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { setRequestLocale } from "next-intl/server";
import { PlaneDissectionWorkspace } from "@/features/tools/plane-dissection/PlaneDissectionWorkspace";
import { planeDissectionMessages } from "@/features/tools/plane-dissection/messages";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const m = planeDissectionMessages(locale);
  return { title: `${m.title} · ${m.preview}`, robots: { index: false, follow: false } };
}

/** 开发审核入口尚未登记到 Tools 场景目录，不生成可插入课堂的假同步教具。 */
export default async function PlaneDissectionPreview({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const m = planeDissectionMessages(locale);
  return <main className="flex h-dvh min-h-0 flex-col bg-paper">
    <header className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-2 text-sm">
      <a href="/design-previews/plane-geometry-teaching-spaces.html#scene-14" className="inline-flex shrink-0 items-center gap-1.5 text-muted hover:text-ink" title={m.review} aria-label={m.review}><ArrowLeft size={16} /><span className="hidden sm:inline">{m.review}</span></a>
      <h1 className="truncate">{m.title}</h1><span className="ml-auto shrink-0 text-xs text-muted">{m.preview}</span>
    </header>
    <PlaneDissectionWorkspace locale={locale} />
    <p className="shrink-0 px-4 py-1 text-center text-xs text-muted">{m.pending}</p>
  </main>;
}
