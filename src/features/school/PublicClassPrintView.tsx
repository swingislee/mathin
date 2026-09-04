"use client";

import { ArrowLeft, Printer } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button, buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { PublicClassSegment, PublicClassWorkbenchData } from "./public-class";

export const PUBLIC_CLASS_PRINT_KINDS = ["signin", "badge", "desk"] as const;
export type PublicClassPrintKind = (typeof PUBLIC_CLASS_PRINT_KINDS)[number];

function formatSession(locale: string, segment: PublicClassSegment) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Shanghai",
  }).format(new Date(segment.scheduledAt));
}

export function PublicClassPrintView({
  data,
  locale,
  kind,
  segment,
}: {
  data: PublicClassWorkbenchData;
  locale: string;
  kind: PublicClassPrintKind;
  segment: PublicClassSegment;
}) {
  const t = useTranslations("school.publicClass");
  const participants = data.participants.filter((participant) => participant.status !== "cancelled");
  const background = segment.printBackgroundPath || data.activity.printBackgroundPath;
  const baseHref = `/dashboard/activities/${data.activity.id}/print`;
  return <>
    <div className="print:hidden">
      <div className="mb-4 flex flex-wrap items-center gap-2 border-y border-line bg-card px-3 py-3">
        <Link href={`/dashboard/activities/${data.activity.id}?view=prepare#print-materials`} className={buttonVariants({ variant: "ghost", size: "sm" })}><ArrowLeft className="size-4" />{t("backToPrint")}</Link>
        <div className="h-5 w-px bg-line" />
        {PUBLIC_CLASS_PRINT_KINDS.map((value) => <Link key={value} href={`${baseHref}?kind=${value}&segment=${segment.id}`} className={buttonVariants({ variant: value === kind ? "primary" : "secondary", size: "sm" })}>{t(`print_${value}`)}</Link>)}
        <div className="h-5 w-px bg-line" />
        {data.segments.map((item) => <Link key={item.id} href={`${baseHref}?kind=${kind}&segment=${item.id}`} className={cn(buttonVariants({ variant: item.id === segment.id ? "primary" : "ghost", size: "sm" }), "max-w-52 truncate")}>{item.title}</Link>)}
        <Button size="sm" className="ml-auto" onClick={() => window.print()}><Printer className="size-4" />{t("printNow")}</Button>
      </div>
      <p className="mb-4 text-sm text-muted">{t("browserPrintHint")}</p>
    </div>

    <main className="public-class-print-root bg-white text-slate-950">
      {kind === "signin" ? <SignInSheet data={data} locale={locale} segment={segment} /> : null}
      {kind === "badge" ? <NameBadges data={data} segment={segment} participants={participants} background={background} /> : null}
      {kind === "desk" ? <DeskCards data={data} segment={segment} participants={participants} background={background} /> : null}
    </main>
    <style jsx global>{`
      @media print {
        @page { size: A4 portrait; margin: 10mm; }
        body * { visibility: hidden !important; }
        .public-class-print-root, .public-class-print-root * { visibility: visible !important; }
        .public-class-print-root { position: absolute; inset: 0 auto auto 0; width: 100%; min-height: 100%; }
        .public-class-print-card { break-inside: avoid; }
      }
    `}</style>
  </>;
}

function SheetHeader({ data, locale, segment }: { data: PublicClassWorkbenchData; locale: string; segment: PublicClassSegment }) {
  const t = useTranslations("school.publicClass");
  const place = segment.roomName
    ? [segment.campusName, segment.roomName].filter(Boolean).join(" · ")
    : segment.location || data.activity.location || "—";
  return <header className="mb-6 border-b-2 border-slate-800 pb-4">
    <div className="flex items-end justify-between gap-4">
      <div><p className="text-sm font-medium tracking-[0.2em] text-slate-500">MATHIN</p><h1 className="mt-1 text-2xl font-bold">{data.activity.title}</h1><p className="mt-1 text-lg">{segment.title}</p></div>
      <div className="text-right text-sm leading-6"><p>{formatSession(locale, segment)}</p><p>{t("printPlace", { place })}</p></div>
    </div>
  </header>;
}

function SignInSheet({ data, locale, segment }: { data: PublicClassWorkbenchData; locale: string; segment: PublicClassSegment }) {
  const t = useTranslations("school.publicClass");
  const participants = data.participants.filter((participant) => participant.status !== "cancelled");
  return <section className="mx-auto min-h-[277mm] w-[190mm] px-1 py-2">
    <SheetHeader data={data} locale={locale} segment={segment} />
    <table className="w-full border-collapse text-sm">
      <thead><tr>{[t("printNo"), t("printName"), t("printGrade"), t("printStudentSign"), t("printGuardianSign"), t("printNote")].map((label) => <th key={label} className="border border-slate-500 px-2 py-2 text-left font-medium">{label}</th>)}</tr></thead>
      <tbody>{participants.map((participant, index) => <tr key={participant.registrationId} className="h-12">
        <td className="w-12 border border-slate-400 px-2 text-center tabular-nums">{index + 1}</td>
        <td className="w-32 border border-slate-400 px-2 font-medium">{participant.name}</td>
        <td className="w-24 border border-slate-400 px-2">{participant.gradeText || (participant.grade ? t("gradeValue", { grade: participant.grade }) : "")}</td>
        <td className="w-28 border border-slate-400 px-2" />
        <td className="w-28 border border-slate-400 px-2" />
        <td className="border border-slate-400 px-2" />
      </tr>)}</tbody>
    </table>
    <p className="mt-4 text-xs text-slate-500">{t("signinFooter", { count: participants.length })}</p>
  </section>;
}

function NameBadges({
  data,
  segment,
  participants,
  background,
}: {
  data: PublicClassWorkbenchData;
  segment: PublicClassSegment;
  participants: PublicClassWorkbenchData["participants"];
  background: string;
}) {
  const t = useTranslations("school.publicClass");
  return <section className="mx-auto grid w-[190mm] grid-cols-2 gap-[5mm] py-2">
    {participants.map((participant) => <article
      key={participant.registrationId}
      className="public-class-print-card relative flex h-[60mm] overflow-hidden border border-slate-300 bg-white"
      style={{ backgroundImage: `url(${background})`, backgroundPosition: "center", backgroundSize: "cover" }}
    >
      <div className="m-auto w-[72%] bg-white/90 px-3 py-3 text-center">
        <p className="text-[11px] tracking-[0.16em] text-slate-500">{data.activity.title}</p>
        <p className="mt-2 text-3xl font-bold tracking-wider">{participant.name}</p>
        <p className="mt-2 text-sm text-slate-600">{participant.gradeText || (participant.grade ? t("gradeValue", { grade: participant.grade }) : t("gradePending"))} · {segment.title}</p>
      </div>
    </article>)}
  </section>;
}

function DeskCards({
  data,
  segment,
  participants,
  background,
}: {
  data: PublicClassWorkbenchData;
  segment: PublicClassSegment;
  participants: PublicClassWorkbenchData["participants"];
  background: string;
}) {
  const t = useTranslations("school.publicClass");
  return <section className="mx-auto grid w-[190mm] grid-cols-2 gap-[5mm] py-2">
    {participants.map((participant) => <article key={participant.registrationId} className="public-class-print-card h-[92mm] border border-dashed border-slate-400 bg-white">
      {[false, true].map((flipped) => <div
        key={String(flipped)}
        className="relative flex h-1/2 overflow-hidden"
        style={{
          backgroundImage: `url(${background})`,
          backgroundPosition: "center",
          backgroundSize: "cover",
          transform: flipped ? "rotate(180deg)" : undefined,
        }}
      >
        <div className="m-auto w-[76%] bg-white/90 px-3 py-2 text-center">
          <p className="text-[10px] tracking-[0.14em] text-slate-500">{data.activity.title}</p>
          <p className="mt-1 text-3xl font-bold tracking-wider">{participant.name}</p>
          <p className="mt-1 text-xs text-slate-600">{participant.gradeText || (participant.grade ? t("gradeValue", { grade: participant.grade }) : "")} · {segment.title}</p>
        </div>
      </div>)}
    </article>)}
  </section>;
}
