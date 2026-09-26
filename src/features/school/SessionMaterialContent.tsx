"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { Download, ExternalLink, LoaderCircle } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { SessionLessonPlanReview } from "./SessionLessonPlanWorkspace";
import { parseSolutionBoardItems } from "./solution-board-items";
import { materialMessages, materialVideoHref, type MaterialContent, type MaterialFile } from "./session-materials-contract";

const SolutionRecordPreview = dynamic(() => import("./CoursewareAnnotationBoard").then(module => module.SolutionRecordPreview), { ssr: false });
const CoursewareReview = dynamic(() => import("./SessionPreparationCoursewareReview").then(module => module.SessionPreparationCoursewareReview), { ssr: false });

function MaterialFiles({ files, locale, onRetry }: { files: MaterialFile[]; locale: string; onRetry: () => void }) {
  const m = materialMessages(locale);
  const [selected, setSelected] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState<string | null>(null);
  const file = files.find(item => item.path === selected);
  const download = async (item: MaterialFile) => {
    setDownloading(item.path); setFailed(null);
    try {
      const { data, error } = await createClient().storage.from("prep-artifacts").download(item.path);
      if (error || !data) throw new Error("DOWNLOAD_FAILED");
      const url = URL.createObjectURL(data);
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = item.name; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setFailed(item.path); }
    finally { setDownloading(null); }
  };
  if (!files.length) return null;
  return <section className="space-y-3" aria-label={m.attachments}>
    <ul className="divide-y divide-line">
      {files.map(item => <li key={item.path} className="flex min-w-0 flex-wrap items-center gap-2 py-2 text-sm">
        <span className="min-w-0 flex-1 break-words">{item.name}</span>
        {item.url ? <>
          {(item.type.startsWith("image/") || item.type === "application/pdf") && <Button size="sm" variant={selected === item.path ? "secondary" : "ghost"} onClick={() => { setPreviewFailed(null); setSelected(selected === item.path ? null : item.path); }}>{m.preview}</Button>}
          <a href={item.url} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "ghost", size: "sm" })}><ExternalLink size={13} />{m.open}</a>
          <Button size="sm" variant="ghost" disabled={downloading !== null} onClick={() => void download(item)}>{downloading === item.path ? <LoaderCircle size={13} className="animate-spin motion-reduce:animate-none" /> : <Download size={13} />}{m.download}</Button>
        </> : <span role="status" className="text-xs text-muted">{m.fileFailed}<Button size="sm" variant="ghost" onClick={onRetry}>{m.retry}</Button></span>}
        {failed === item.path && <p role="alert" className="w-full text-xs text-rose">{m.downloadFailed}</p>}
      </li>)}
    </ul>
    {file?.url && <div className="space-y-2">
      {file.type === "application/pdf" ? <>
        <iframe src={file.url} title={file.name} className="h-[60dvh] w-full" referrerPolicy="no-referrer" sandbox="allow-same-origin" />
        <p className="text-xs text-muted">{m.pdfHint}</p>
      </> : /* eslint-disable-next-line @next/next/no-img-element -- 按当前用户权限签发的短期材料地址。 */
        <img src={file.url} alt={file.name} className="max-h-[60dvh] max-w-full object-contain" onError={() => setPreviewFailed(file.path)} />}
      {previewFailed === file.path && <p role="status" className="text-xs text-muted">{m.previewUnavailable}</p>}
    </div>}
  </section>;
}

export function SessionMaterialContent({ content, locale, timeZone, sessionId, onRetry }: {
  content: MaterialContent; locale: string; timeZone: string; sessionId: string; onRetry: () => void;
}) {
  const m = materialMessages(locale);
  const date = (value: string) => new Intl.DateTimeFormat(locale, { timeZone, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
  if (content.kind === "rehearsal_video") {
    const href = materialVideoHref(content.url);
    return content.url ? <div className="space-y-3 py-2">
      <p className="text-xs text-muted">{m.videoHint}</p>
      {href ? <a href={href} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "secondary", size: "sm" })}><ExternalLink size={14} />{m.openVideo}</a> : <p role="status" className="text-sm text-muted">{m.invalidVideo}</p>}
      {href && <label className="block max-w-xl space-y-1 text-xs text-muted">{m.videoLink}<Input readOnly value={href} onFocus={event => event.currentTarget.select()} /></label>}
    </div> : <p className="py-4 text-sm text-muted">{m.noVideo}</p>;
  }
  if (content.kind === "courseware") return <CoursewareReview sessionId={sessionId} pages={content.pages} docs={content.docs} overlayAssetUrls={content.overlayAssetUrls} prepStep="study" readOnly unavailableLabel={m.pageMissing} />;
  if (content.kind === "lesson_plan") return <div className="space-y-3">
    {content.plan ? <>
      <p className="flex flex-wrap gap-3 text-xs text-muted"><span>{m.planBody}</span><span>{m[content.plan.status]}</span><span>{m.revision} {content.plan.revision}</span><span>{m.updated} {date(content.plan.updatedAt)}</span></p>
      {content.plan.content.length > 0 ? <SessionLessonPlanReview content={content.plan.content} revision={content.plan.revision} /> : <p className="text-sm text-muted">{m.emptyPlan}</p>}
    </> : <p className="py-2 text-sm text-muted">{m.noPlan}</p>}
    <MaterialFiles files={content.files} locale={locale} onRetry={onRetry} />
  </div>;
  return <div className="space-y-4">
    {content.notes && <p className="whitespace-pre-wrap text-sm leading-6">{content.notes}</p>}
    <MaterialFiles files={content.files} locale={locale} onRetry={onRetry} />
    {content.previewFailed && <p role="alert" className="text-xs text-muted">{m.previewFailed}<Button size="sm" variant="ghost" onClick={onRetry}>{m.retry}</Button></p>}
    {content.records.map((record, index) => {
      const page = content.pages.find(item => item.pageDocId === record.pageDocId) ?? null;
      const items = parseSolutionBoardItems(record.content.items ?? record.content.strokes);
      return <section key={record.id} className="space-y-2">
        <p className="flex flex-wrap gap-3 text-xs text-muted"><span>{m.board} · {record.pageDocId && content.pageLabels[record.pageDocId] || index + 1}</span><span>{m.revision} {record.revision}</span><span>{m.updated} {date(record.updatedAt)}</span></p>
        {items ? <div className="max-w-4xl"><SolutionRecordPreview items={items} previewId={`material-solution-${sessionId}-${record.id}`} label={`${m.board} ${index + 1}`} pagePreview={page} unavailableLabel={m.pageMissing} /></div> : <p className="text-sm text-muted">{m.failed}</p>}
      </section>;
    })}
    {!content.notes && !content.files.length && !content.records.length && <p className="py-4 text-sm text-muted">{m.noSolutions}</p>}
  </div>;
}
