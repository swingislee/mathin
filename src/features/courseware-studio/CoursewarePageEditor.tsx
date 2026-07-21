"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Plus, RotateCcw, Save, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StagePreview } from "@/features/courseware-studio/StagePreview";
import { FullScreenToolShell } from "@/features/school/stage/FullScreenToolShell";
import { StageViewport } from "@/features/school/stage/StageViewport";
import type { DocNode, PageDoc } from "@/features/courseware-doc/schema";
import type { ResolvedBindingUrls } from "@/features/courseware-doc/resolve";
import type { CoursewareTrack, StudioImageAssetUsage, StudioPageSummary, StudioRelease, StudioRevision } from "./data";
import {
  createBlankCoursewarePageAction,
  copyCoursewarePageAction,
  deleteCoursewarePageAction,
  replaceCoursewarePageImageAction,
  reorderCoursewarePagesAction,
  revertCoursewarePageAction,
  rollbackCoursewareReleaseAction,
  saveCoursewareDraftAction,
  submitCoursewareReviewAction,
} from "./actions";
import { useRouter } from "@/i18n/navigation";
import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";

type Props = {
  lecture: { id: string; courseId: string; no: number; name: string };
  track: CoursewareTrack;
  page: StudioPageSummary;
  pages: StudioPageSummary[];
  initialDoc: PageDoc;
  baseRevisionNo: number;
  revisions: StudioRevision[];
  releases: StudioRelease[];
  bindingUrls: ResolvedBindingUrls;
  imageAssetUsage: Record<string, StudioImageAssetUsage>;
  copyTargets: Array<{ id: string; no: number; name: string }>;
  canPublish: boolean;
  canSubmitReview: boolean;
  lectureWorkspaceHref: string;
};

function clone<T>(value: T): T { return structuredClone(value); }

function visit(nodes: DocNode[], nodePath: string): DocNode | null {
  for (const node of nodes) {
    if (node.nodePath === nodePath) return node;
    const nested = visit(node.children, nodePath);
    if (nested) return nested;
  }
  return null;
}

function manualNode(kind: "text" | "rich_text" | "shape" | "image" | "video", index: number): DocNode {
  const isText = kind === "text" || kind === "rich_text";
  return {
    id: `mathin-manual-${index}`,
    nodePath: `mathin-manual-${index}`,
    sourceType: `mathin:${kind}`,
    sourceResourceId: null,
    adapter: kind === "shape" ? "shape" : kind === "rich_text" ? "rich_text" : kind,
    name: kind,
    supported: kind !== "image" && kind !== "video",
    visible: true,
    interactive: false,
    zIndex: index + 1000,
    order: index + 1000,
    crop: null,
    transform: { x: 80, y: 80, width: isText ? 360 : 240, height: isText ? 80 : 180, rotation: 0, scaleX: 1, scaleY: 1, anchorX: 0, anchorY: 0, opacity: 1, flipX: false, flipY: false, clip: false },
    style: { objectFit: "contain", backgroundColor: kind === "shape" ? "#ffffff" : null, color: "#000000", borderColor: kind === "shape" ? "#000000" : null, borderWidth: kind === "shape" ? 1 : 0, borderRadius: 0, fontFamily: null, fontSize: 28, fontWeight: null, lineHeight: 1.4, letterSpacing: null, whiteSpace: "normal", textAlign: "left", overflow: "visible" },
    content: kind === "rich_text" ? { kind: "rich_text", html: "<p>新文本</p>" } : kind === "text" ? { kind: "text", text: "新文本" } : kind === "shape" ? { kind: "shape", shapeType: "rectangle", svg: "" } : { kind: "unsupported", summary: "请在资源面板替换为已上传资源" },
    resources: [],
    children: [],
  };
}

export function CoursewarePageEditor({ lecture, track, page, pages, initialDoc, baseRevisionNo, revisions, releases, bindingUrls, imageAssetUsage, copyTargets, canPublish, canSubmitReview, lectureWorkspaceHref }: Props) {
  const router = useRouter();
  const t = useTranslations("coursewareStudio");
  const [doc, setDoc] = useState<PageDoc>(() => clone(initialDoc));
  const [savedDocJson, setSavedDocJson] = useState(() => JSON.stringify(initialDoc));
  const [currentBaseRevisionNo, setCurrentBaseRevisionNo] = useState(baseRevisionNo);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [copyTargetId, setCopyTargetId] = useState(lecture.id);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const selected = useMemo(() => selectedPath ? visit(doc.nodes, selectedPath) : null, [doc, selectedPath]);
  const imageBinding = selected?.resources.find((resource) => resource.kind === "image") ?? null;
  const imageUsage = imageBinding ? imageAssetUsage[imageBinding.bindingKey] : null;
  const isDirty = useMemo(() => JSON.stringify(doc) !== savedDocJson, [doc, savedDocJson]);

  // router.refresh() 后 Server Component 会给同一编辑器实例一份新草稿。若不把
  // 乐观锁基线一并推进，第二次保存必然带旧 revision_no 而得到 VERSION_CONFLICT。
  useEffect(() => {
    setDoc(clone(initialDoc));
    setSavedDocJson(JSON.stringify(initialDoc));
    setCurrentBaseRevisionNo(baseRevisionNo);
    setSelectedPath(null);
    setImageFile(null);
  }, [page.id, track, initialDoc, baseRevisionNo]);

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (!isDirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  const patchSelected = (mutate: (node: DocNode) => void) => {
    if (!selectedPath) return;
    setDoc((current) => {
      const next = clone(current);
      const target = visit(next.nodes, selectedPath);
      if (target) mutate(target);
      return next;
    });
  };
  const numeric = (key: keyof DocNode["transform"] | "fontSize" | "lineHeight" | "zIndex", raw: string) => {
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    patchSelected((node) => {
      if (key === "fontSize" || key === "lineHeight") node.style[key] = value;
      else if (key === "zIndex") node.zIndex = Math.round(value);
      else (node.transform[key] as number) = value;
    });
  };
  const save = () => startTransition(async () => {
    const result = await saveCoursewareDraftAction({ pageDocId: page.id, track, doc, baseRevisionNo: currentBaseRevisionNo, note });
    setMessage(result.ok ? t("savedDraft", { revision: result.data.revisionNo }) : t("saveFailed", { code: result.code }));
    if (result.ok) {
      setCurrentBaseRevisionNo(result.data.revisionNo);
      setSavedDocJson(JSON.stringify(doc));
      router.refresh();
    }
  });
  const submitReview = () => startTransition(async () => {
    const result = await submitCoursewareReviewAction(lecture.id, track, note);
    setMessage(result.ok ? t("reviewSubmitted") : t("submitReviewFailed", { code: result.code }));
    if (result.ok) router.refresh();
  });
  const add = (kind: "text" | "rich_text" | "shape" | "image" | "video") => {
    setDoc((current) => ({ ...current, nodes: [...current.nodes, manualNode(kind, current.nodes.length + 1)] }));
  };
  const studioHref = (pageId: string | null, nextTrack = track) => {
    const query = new URLSearchParams({ track: nextTrack });
    if (pageId) query.set("page", pageId);
    return `/studio/courseware/${lecture.id}?${query.toString()}`;
  };
  const guardedNavigate = (href: string) => {
    if (isDirty) { setPendingHref(href); return; }
    router.push(href);
  };
  const guardLinkClick = (href: string) => (event: React.MouseEvent) => {
    if (!isDirty) return;
    event.preventDefault();
    setPendingHref(href);
  };
  const navigatePage = (id: string) => guardedNavigate(studioHref(id));
  const move = (direction: -1 | 1) => {
    const index = pages.findIndex((item) => item.id === page.id);
    const target = index + direction;
    if (target < 0 || target >= pages.length) return;
    const ordered = [...pages];
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    startTransition(async () => {
      const result = await reorderCoursewarePagesAction({ lectureId: lecture.id, pageIds: ordered.map((item) => item.id) });
      setMessage(result.ok ? t("pageOrderUpdated") : t("orderFailed", { code: result.code }));
      if (result.ok) router.refresh();
    });
  };

  const toolbar = <div className="flex h-full items-center gap-2 overflow-x-auto">
    <Link href={lectureWorkspaceHref} onClick={guardLinkClick(lectureWorkspaceHref)} className="shrink-0 rounded-full border border-line px-3 py-1.5 text-xs text-muted transition hover:bg-paper hover:text-ink">{t("backToLectureWorkspace")}</Link>
    <span className="shrink-0 truncate text-sm font-medium text-ink">{t("lectureTitle", { no: lecture.no, name: lecture.name })}</span>
    <div className="inline-flex shrink-0 rounded-lg border border-line bg-paper p-1">
      <Link href={studioHref(page.id, "native-16x9")} onClick={guardLinkClick(studioHref(page.id, "native-16x9"))} className={`rounded-md px-3 py-1.5 text-xs ${track === "native-16x9" ? "bg-card font-medium text-ink shadow-sm" : "text-muted hover:text-ink"}`}>{t("trackNative")}</Link>
      <Link href={studioHref(page.id, "adapted-4x3")} onClick={guardLinkClick(studioHref(page.id, "adapted-4x3"))} className={`rounded-md px-3 py-1.5 text-xs ${track === "adapted-4x3" ? "bg-card font-medium text-ink shadow-sm" : "text-muted hover:text-ink"}`}>{t("trackAdapted")}</Link>
    </div>
    <div className="ml-auto flex shrink-0 items-center gap-2">
      <Button variant="secondary" size="sm" disabled={pending} onClick={() => move(-1)}>{t("moveUp")}</Button>
      <Button variant="secondary" size="sm" disabled={pending} onClick={() => move(1)}>{t("moveDown")}</Button>
      <Button variant="secondary" size="sm" disabled={pending} onClick={() => startTransition(async () => {
        const result = await createBlankCoursewarePageAction({ lectureId: lecture.id, afterPageDocId: page.id, title: t("newPage") });
        if (result.ok) navigatePage(result.data.pageId); else setMessage(t("insertFailed", { code: result.code }));
      })}><Plus className="size-4" />{t("insertPage")}</Button>
      <Button variant="secondary" size="sm" disabled={pending} onClick={() => startTransition(async () => {
        const result = await deleteCoursewarePageAction(page.id);
        if (result.ok) router.push(studioHref(null)); else setMessage(t("deleteFailed", { code: result.code }));
      })}><Trash2 className="size-4" />{t("deletePage")}</Button>
      <Button size="sm" disabled={pending} onClick={save}><Save className="size-4" />{t("saveDraft")}</Button>
      {canSubmitReview && <Button size="sm" variant="secondary" disabled={pending} onClick={submitReview}><Send className="size-4" />{t("submitReview")}</Button>}
    </div>
  </div>;

  const leftPanel = <div className="p-3">
    <p className="mb-2 text-sm font-medium text-ink">{t("pageList")}</p>
    <div className="space-y-1">
      {pages.map((item) => <Button key={item.id} variant="ghost" size="sm" onClick={() => navigatePage(item.id)} className={`w-full justify-start ${item.id === page.id ? "bg-moon text-ink" : "text-muted hover:bg-paper"}`}>{t("pageItem", { no: item.pageNo })} {item.adaptClass ? <span className="ml-auto">{item.adaptClass}</span> : null}</Button>)}
    </div>
  </div>;

  const rightPanel = <div className="space-y-4 p-3">
    <div>
      <p className="mb-2 text-sm font-medium text-ink">{t("properties")}</p>
      {selected ? <div className="space-y-3">
        <p className="break-all text-xs text-muted">{selected.nodePath}</p>
        <Label>{t("textOrHtml")}</Label>
        <Textarea className="h-28 min-h-28 max-h-48 resize-y" value={selected.content?.html ?? selected.content?.text ?? ""} onChange={(event) => patchSelected((node) => { if (node.content?.kind === "rich_text" || node.content?.kind === "shape") node.content.html = event.target.value; else if (node.content) node.content.text = event.target.value; })} />
        {imageBinding ? <div className="space-y-2"><Label htmlFor="courseware-image">{t("replaceImage")}</Label>{imageUsage ? <p className="text-xs text-muted">{t("sharedAsset", { name: imageUsage.name })}<br />{t("assetUseCountInTrack", { count: imageUsage.useCount, track: track === "adapted-4x3" ? t("trackAdapted") : t("trackNative") })}<br /><Link href={`/dashboard/courseware/assets/${imageUsage.sharedAssetId}`} className="underline underline-offset-2 hover:text-ink">{t("openAssetLibrary")}</Link></p> : null}<Input id="courseware-image" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => setImageFile(event.target.files?.[0] ?? null)} /><div className="flex flex-wrap gap-2"><Button variant="secondary" size="sm" disabled={pending || !imageFile} onClick={() => startTransition(async () => { if (!imageFile) return; const result = await replaceCoursewarePageImageAction({ pageDocId: page.id, bindingKey: imageBinding.bindingKey, track, scope: "current-page", file: imageFile }); setMessage(result.ok ? t("imageReplaced") : t("imageReplaceFailed", { code: result.code })); if (result.ok) { setImageFile(null); router.refresh(); } })}>{t("replaceThisPage")}</Button><Button size="sm" disabled={pending || !imageFile || !imageUsage} onClick={() => startTransition(async () => { if (!imageFile) return; const result = await replaceCoursewarePageImageAction({ pageDocId: page.id, bindingKey: imageBinding.bindingKey, track, scope: "all-track", file: imageFile }); setMessage(result.ok ? t("imageReplacedInTrack", { count: result.data.affectedCount }) : t("imageReplaceFailed", { code: result.code })); if (result.ok) { setImageFile(null); router.refresh(); } })}>{t("replaceAllInTrack", { count: imageUsage?.useCount ?? 0 })}</Button></div><p className="text-xs text-muted">{t("trackReplacementHint")}</p></div> : null}
        <div className="grid grid-cols-2 gap-2">
          {(["x", "y", "width", "height", "rotation"] as const).map((key) => <label key={key} className="text-xs text-muted">{key}<Input type="number" value={selected.transform[key]} onChange={(event) => numeric(key, event.target.value)} /></label>)}
          <label className="text-xs text-muted">{t("fontSize")}<Input type="number" value={selected.style.fontSize ?? ""} onChange={(event) => numeric("fontSize", event.target.value)} /></label>
          <label className="text-xs text-muted">{t("fontFamily")}<Input value={selected.style.fontFamily ?? ""} onChange={(event) => patchSelected((node) => { node.style.fontFamily = event.target.value.trim() || null; })} /></label>
          <label className="text-xs text-muted">{t("lineHeight")}<Input type="number" step="0.1" value={selected.style.lineHeight ?? ""} onChange={(event) => numeric("lineHeight", event.target.value)} /></label>
          <label className="text-xs text-muted">{t("opacity")}<Input type="number" min="0" max="1" step="0.05" value={selected.transform.opacity} onChange={(event) => numeric("opacity", event.target.value)} /></label>
          <label className="text-xs text-muted">{t("layer")}<Input type="number" value={selected.zIndex} onChange={(event) => numeric("zIndex", event.target.value)} /></label>
        </div>
        <label className="flex items-center gap-2 text-sm text-muted"><Checkbox checked={selected.visible} onCheckedChange={(checked) => patchSelected((node) => { node.visible = checked === true; })} />{t("visible")}</label>
      </div> : <p className="text-sm text-muted">{t("selectNode")}</p>}
    </div>
    <div>
      <p className="mb-2 text-sm font-medium text-ink">{t("copyPage")}</p>
      <Select value={copyTargetId} onValueChange={setCopyTargetId}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>{copyTargets.map((target) => <SelectItem key={target.id} value={target.id}>{t("lectureTitle", { no: target.no, name: target.name })}</SelectItem>)}</SelectContent>
      </Select>
      <Button className="mt-2 w-full" variant="secondary" size="sm" disabled={pending} onClick={() => startTransition(async () => {
        const result = await copyCoursewarePageAction({ sourcePageDocId: page.id, targetLectureId: copyTargetId, afterPageDocId: null, title: page.title });
        setMessage(result.ok ? t("copySucceeded") : t("copyFailed", { code: result.code }));
        if (result.ok && copyTargetId === lecture.id) navigatePage(result.data.pageId);
      })}>{t("copyToLecture")}</Button>
    </div>
    <div>
      <p className="mb-2 text-sm font-medium text-ink">{t("pageVersions")}</p>
      <div className="space-y-2">
        {revisions.map((revision) => <div key={revision.id} className="rounded-lg border border-line p-2 text-xs text-muted"><p>{t("revisionLabel", { no: revision.revisionNo })} · {revision.origin}</p><p>{revision.note || "—"}</p><p>{t("revisionSummary", { nodes: revision.doc.nodes.length, interactions: revision.doc.interactions.length })}</p><Button variant="ghost" size="sm" disabled={pending} onClick={() => { setDoc(clone(revision.doc)); setSelectedPath(null); setMessage(t("previewingRevision", { no: revision.revisionNo })); }}>{t("previewRevision")}</Button><Button variant="ghost" size="sm" disabled={pending || revision.track !== track || revision.revisionNo === currentBaseRevisionNo} onClick={() => startTransition(async () => { const result = await revertCoursewarePageAction({ pageDocId: page.id, track, revisionId: revision.id, baseRevisionNo: currentBaseRevisionNo, note: t("revisionLabel", { no: revision.revisionNo }) }); setMessage(result.ok ? t("revertDraftCreated") : t("revertFailed", { code: result.code })); if (result.ok) { setCurrentBaseRevisionNo(result.data.revisionNo); router.refresh(); } })}><RotateCcw className="size-3" />{t("revertTo")}</Button></div>)}
      </div>
    </div>
    {canPublish && <div>
      <p className="mb-2 text-sm font-medium text-ink">{t("lectureReleases")}</p>
      <div className="space-y-2">
        {releases.map((release) => <div key={release.id} className="rounded-lg border border-line p-2 text-xs text-muted"><p>Release {release.releaseNo}</p><p>{release.note || "—"}</p><Button variant="ghost" size="sm" disabled={pending} onClick={() => startTransition(async () => { const result = await rollbackCoursewareReleaseAction(lecture.id, track, release.id, `release ${release.releaseNo}`); setMessage(result.ok ? t("rollbackPublished") : t("rollbackFailed", { code: result.code })); if (result.ok) router.refresh(); })}>{t("rollbackLecture")}</Button></div>)}
      </div>
    </div>}
    <details className="rounded-2xl border border-line bg-card p-3"><summary className="cursor-pointer text-sm text-muted">{t("advancedJson")}</summary><Textarea className="mt-3 min-h-80 font-mono text-xs" value={JSON.stringify(doc, null, 2)} onChange={(event) => { try { setDoc(JSON.parse(event.target.value) as PageDoc); setMessage(""); } catch { setMessage(t("invalidJson")); } }} /></details>
  </div>;

  return <>
    <FullScreenToolShell
      toolbar={toolbar}
      leftPanel={leftPanel}
      leftPanelTitle={t("pageList")}
      rightPanel={rightPanel}
      rightPanelTitle={t("properties")}
      openLeftLabel={t("openPageList")}
      openRightLabel={t("openProperties")}
      closeLabel={t("closePanel")}
      statusBar={<div className="shrink-0 border-t border-line px-4 py-2 text-xs text-muted" role="status">{message || t("editorHint", { page: page.pageNo, title: page.title ? `· ${page.title}` : "" })}</div>}
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="min-h-0 flex-1">
          <StageViewport intrinsicWidth={doc.canvas.width} intrinsicHeight={doc.canvas.height}>
            <StagePreview doc={doc} bindingUrls={bindingUrls} stageMode="natural" onNodeSelect={setSelectedPath} />
          </StageViewport>
        </div>
        <div className="shrink-0 border-t border-line p-3">
          <div className="flex flex-wrap gap-2">
            {(["text", "rich_text", "shape", "image", "video"] as const).map((kind) => <Button key={kind} variant="secondary" size="sm" onClick={() => add(kind)}>{t("addElement", { kind })}</Button>)}
          </div>
          <div className="mt-3">
            <Label htmlFor="courseware-note">{t("saveNote")}</Label>
            <Input id="courseware-note" value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} placeholder={t("saveNotePlaceholder")} />
          </div>
        </div>
      </div>
    </FullScreenToolShell>

    <Dialog open={pendingHref !== null} onOpenChange={(open) => { if (!open) setPendingHref(null); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("unsavedChangesTitle")}</DialogTitle>
          <DialogDescription>{t("unsavedChangesBody")}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setPendingHref(null)}>{t("keepEditing")}</Button>
          <Button type="button" variant="secondary" onClick={() => { const href = pendingHref; setPendingHref(null); if (href) router.push(href); }}>{t("leaveAnyway")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
