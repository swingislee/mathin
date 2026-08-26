"use client";

import { useState, useTransition } from "react";
import { Check, LoaderCircle, RotateCcw, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { StagePreview } from "@/features/courseware-studio/StagePreview";
import { useRouter } from "@/i18n/navigation";
import { approveTeacherMicrocourseReviewAction, rejectTeacherMicrocourseReviewAction } from "./actions";
import type { TeacherMicrocourseReview } from "./data";

export function MicrocourseReviewPanel({ review }: { review: TeacherMicrocourseReview }) {
  const t = useTranslations("teacherMicrocourses");
  const locale = useLocale();
  const router = useRouter();
  const [selectedPageId, setSelectedPageId] = useState(review.pages[0]?.pageDocId ?? null);
  const [reviewedPages, setReviewedPages] = useState<number[]>(review.pages.map((page) => page.pageNo));
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const currentPage = review.pages.find((page) => page.pageDocId === selectedPageId) ?? review.pages[0] ?? null;
  const toggleReviewed = (pageNo: number) => setReviewedPages((current) => current.includes(pageNo) ? current.filter((value) => value !== pageNo) : [...current, pageNo].sort((a, b) => a - b));
  const approve = () => startTransition(async () => {
    const result = await approveTeacherMicrocourseReviewAction({ reviewCycleId: review.reviewCycleId, note, reviewedPages });
    if (!result.ok) { setMessage(t("actionFailed", { code: result.code })); return; }
    if (result.data.status === "in_review") router.replace(`/dashboard/courseware/review/microcourses/${result.data.reviewCycleId}`);
    else router.push("/dashboard/courseware/review?tab=microcourses");
  });
  const reject = () => startTransition(async () => {
    const result = await rejectTeacherMicrocourseReviewAction({ reviewCycleId: review.reviewCycleId, note, reviewedPages });
    if (!result.ok) { setMessage(t("actionFailed", { code: result.code })); return; }
    router.push("/dashboard/courseware/review?tab=microcourses");
  });

  return <div className="space-y-4">
    <Card><CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle>{review.metadata.title}</CardTitle><p className="mt-1 text-sm text-muted">{review.authorName} · {new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(review.submittedAt))}</p></div><Badge variant="secondary">{t("reviewRound", { current: review.reviewRoundNo, required: review.requiredReviewRounds })}</Badge></div></CardHeader><CardContent><p className="text-sm leading-6 text-muted">{review.metadata.description || t("noDescription")}</p><div className="mt-3 flex flex-wrap gap-2"><Badge variant="outline">{t("gradeValue", { grade: review.metadata.grade })}</Badge><Badge variant="outline">{locale === "en" ? review.metadata.primaryTopicTitleEn : review.metadata.primaryTopicTitleZh}</Badge>{review.metadata.courseSeason && <Badge variant="outline">{t(`season_${review.metadata.courseSeason}`)}</Badge>}{review.metadata.classType && <Badge variant="outline">{review.metadata.classType}</Badge>}{review.metadata.keywords.map((keyword) => <Badge key={keyword} variant="outline">{keyword}</Badge>)}</div>{review.submissionNote && <p className="mt-3 rounded-lg bg-paper px-3 py-2 text-sm text-muted">{t("submissionNote", { note: review.submissionNote })}</p>}</CardContent></Card>
    <div className="grid min-h-[42rem] gap-4 xl:grid-cols-[17rem_minmax(0,1fr)_20rem]">
      <Card className="overflow-hidden"><CardHeader className="pb-3"><CardTitle className="text-base">{t("snapshotPages", { count: review.pages.length })}</CardTitle></CardHeader><CardContent className="h-[37rem] p-3 pt-0"><ScrollArea className="h-full"><ol className="space-y-2 pr-2">{review.pages.map((page) => <li key={page.pageDocId} className="flex items-center gap-2"><Checkbox checked={reviewedPages.includes(page.pageNo)} onCheckedChange={() => toggleReviewed(page.pageNo)} aria-label={t("markReviewed", { page: page.pageNo })} /><Button type="button" variant="ghost" size="sm" onClick={() => setSelectedPageId(page.pageDocId)} className={`h-auto min-w-0 flex-1 justify-start rounded-lg border px-3 py-2 text-left ${page.pageDocId === currentPage?.pageDocId ? "border-crater bg-moon/30" : "border-line"}`}><span className="truncate">{page.pageNo}. {page.title}</span></Button></li>)}</ol></ScrollArea></CardContent></Card>
      <Card className="grid place-items-center overflow-hidden p-4">{currentPage ? <div className="w-full max-w-5xl overflow-hidden rounded-xl border border-line bg-white"><StagePreview doc={currentPage.doc} bindingUrls={currentPage.bindingUrls} stageMode="natural" className="w-full" interactive /></div> : <p className="text-sm text-muted">{t("emptyPages")}</p>}</Card>
      <Card><CardHeader><CardTitle className="text-base">{t("reviewDecision")}</CardTitle></CardHeader><CardContent className="space-y-4"><p className="text-xs leading-5 text-muted">{t("immutableSnapshotHint")}</p><Label className="grid gap-1"><span>{t("reviewNote")}</span><Textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} rows={8} placeholder={t("reviewDecisionHint")} /></Label><p className="text-xs text-muted">{t("reviewedCount", { count: reviewedPages.length, total: review.pages.length })}</p>{message && <p role="alert" className="text-sm text-rose">{message}</p>}<div className="grid gap-2"><Button type="button" disabled={pending || reviewedPages.length !== review.pages.length} onClick={approve}>{pending ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}{t("approveAndPublish")}</Button><Button type="button" variant="secondary" disabled={pending || !note.trim()} onClick={reject}><X className="size-4" />{t("rejectForChanges")}</Button><Button type="button" variant="ghost" disabled={pending} onClick={() => setReviewedPages(review.pages.map((page) => page.pageNo))}><RotateCcw className="size-4" />{t("markAllReviewed")}</Button></div></CardContent></Card>
    </div>
  </div>;
}
