"use client";

import { useEffect, useState } from "react";
import { newId } from "@/lib/uuid";
import { Button } from "@/components/ui/button";
import { DashboardSection } from "../dashboard-page";
import type { ActivityPage, ActivityPageBlock } from "../../../../contracts/participant-api/activity-detail";
import type { ActivityPageState, ActivityPageTarget } from "./contract";
import { loadActivityPage, restoreActivityPage, saveActivityPage, uploadActivityPageImage } from "./actions";
import { ActivityPagePreview } from "./Preview";
import { pageWords } from "./messages";

const field = "w-full rounded-lg border border-line bg-card px-3 py-2 text-sm";
type Notice = "" | "forbidden" | "failed" | "conflict" | "validation" | "published" | "draftSaved";
export function ActivityPageEditor({ target, title, description, locale }: {
  target: ActivityPageTarget; title: string; description: string; locale: "zh" | "en";
}) {
  const t = pageWords[locale];
  const [page, setPage] = useState<ActivityPage | null>(null), [state, setState] = useState<ActivityPageState | null>(null);
  const [baseline, setBaseline] = useState(""), [notice, setNotice] = useState<Notice>(""), [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState<"load" | "save" | "publish" | "upload" | null>("load"), [loadVersion, setLoadVersion] = useState(0);
  const [initial] = useState({ description, intro: t.intro });
  const dirty = !!page && baseline !== JSON.stringify(page);
  const listing = page?.listing || { cover: "", summary: "", labels: [], sortOrder: 0 };
  const signup = page?.signup || { instructions: "", confirmation: "", success: "" };
  useEffect(() => {
    let active = true;
    void loadActivityPage({ kind: target.kind, targetId: target.targetId }).then(result => {
      if (!active) return;
      if (!result.ok) { setNotice(result.code === "FORBIDDEN" ? "forbidden" : "failed"); return; }
      const next: ActivityPage = result.data.draft || { version: 1, layout: "cards", cover: "",
        blocks: initial.description ? [{ id: newId(), type: "text", title: initial.intro, body: initial.description }] : [] };
      setState(result.data); setPage(next); setBaseline(JSON.stringify(next)); setConflict(false);
    }).catch(() => { if (active) setNotice("failed"); }).finally(() => { if (active) setBusy(null); });
    return () => { active = false; };
  }, [target.kind, target.targetId, loadVersion, initial]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const errorMessage = (code: string): Notice => code === "FORM_CHANGED" ? "conflict" : code === "FORBIDDEN" ? "forbidden" : code === "VALIDATION" ? "validation" : "failed";
  function reload() { setBusy("load"); setNotice(""); setLoadVersion(v => v + 1); }
  function patchBlock(id: string, change: Partial<ActivityPageBlock>) {
    setPage(previous => previous && ({ ...previous, blocks: previous.blocks.map(b => b.id === id ? { ...b, ...change } as ActivityPageBlock : b) }));
  }
  function move(index: number, offset: number) {
    if (!page) return;
    const blocks = [...page.blocks]; [blocks[index], blocks[index + offset]] = [blocks[index + offset], blocks[index]];
    setPage({ ...page, blocks });
  }
  function add(type: ActivityPageBlock["type"]) {
    if (!page || page.blocks.length >= 30) return;
    const id = newId(), block: ActivityPageBlock = type === "text" ? { id, type, title: "", body: "" }
      : type === "image" ? { id, type, imagePath: "", caption: "" } : { id, type, imagePath: "", title: "", body: "", position: "above" };
    setPage({ ...page, blocks: [...page.blocks, block] });
  }
  async function upload(file: File, blockId?: string) {
    if (busy) return;
    if (!file.size || file.size > 5 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) { setNotice("validation"); return; }
    setBusy("upload"); setNotice("");
    const form = new FormData(); form.set("kind", target.kind); form.set("targetId", target.targetId); form.set("image", file);
    try {
      const result = await uploadActivityPageImage(form);
      if (!result.ok) { setNotice(errorMessage(result.code)); return; }
      if (blockId === "listing") setPage(previous => previous && ({ ...previous, listing: { ...listing, cover: result.data.path } }));
      else if (blockId) patchBlock(blockId, { imagePath: result.data.path });
      else setPage(previous => previous && ({ ...previous, cover: result.data.path }));
    } catch { setNotice("failed"); } finally { setBusy(null); }
  }
  async function save(publish: boolean) {
    if (!page || !state || busy || conflict) return;
    setBusy(publish ? "publish" : "save"); setNotice("");
    try {
      const result = await saveActivityPage({ ...target, page, revision: state.revision, publish });
      if (!result.ok) { setNotice(errorMessage(result.code)); setConflict(result.code === "FORM_CHANGED"); return; }
      setState(result.data); setBaseline(JSON.stringify(page)); setNotice(publish ? "published" : "draftSaved");
    } catch { setNotice("failed"); } finally { setBusy(null); }
  }
  async function restore(sourceRevision: number) {
    if (!state || busy || dirty || conflict) return;
    setBusy("save"); setNotice("");
    try {
      const result = await restoreActivityPage({ ...target, sourceRevision, revision: state.revision });
      if (!result.ok) { setNotice(errorMessage(result.code)); setConflict(result.code === "FORM_CHANGED"); return; }
      setState(result.data); setPage(result.data.draft); setBaseline(JSON.stringify(result.data.draft)); setNotice("draftSaved");
    } catch { setNotice("failed"); } finally { setBusy(null); }
  }
  const picker = (path: string, blockId?: string) => <label className="grid gap-2 text-sm">{path ? t.replace : t.upload}
    <input type="file" accept="image/jpeg,image/png,image/webp" className="max-w-full text-sm file:mr-3 file:rounded-lg file:border file:border-line file:bg-card file:px-3 file:py-2"
      onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file, blockId); }} /></label>;
  return <DashboardSection title={t.title} description={t.hint}>
    <div aria-live="polite" className="mb-4 space-y-2 text-sm">
      {notice && <p role="status">{t[notice]}</p>}
      {busy && <p className="text-muted">{busy === "load" ? t.loading : busy === "upload" ? t.uploading : busy === "publish" ? t.publishing : t.saving}</p>}
      {!page && !busy && <Button size="sm" variant="secondary" onClick={reload}>{t.retry}</Button>}
      {conflict && <Button size="sm" variant="secondary" disabled={!!busy} onClick={reload}>{t.reload}</Button>}
    </div>
    {page && state && <>
      <div className="mb-5 flex flex-wrap items-center gap-3 text-sm">
        <span className="text-muted">{dirty || !state.revision ? t.dirty : t.saved} · {state.publishedRevision === null ? t.first : state.revision !== state.publishedRevision ? t.pending : t.live}</span>
        {state.publishedAt && <time className="text-xs text-muted">{new Date(state.publishedAt).toLocaleString(locale)}</time>}
      </div>
      <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_375px]">
        <fieldset disabled={!!busy} className="min-w-0 space-y-5 disabled:opacity-70">
          <label className="grid gap-1 text-sm">{t.layout}<select className={field} value={page.layout} onChange={e => setPage({ ...page, layout: e.target.value as ActivityPage["layout"] })}>
            <option value="cards">{t.cards}</option><option value="continuous">{t.continuous}</option>
          </select></label>
          <div className="space-y-3 rounded-xl border border-line p-4"><h3 className="text-sm font-medium">{t.cover}</h3>{picker(page.cover)}
            <p className="text-xs text-muted">{t.imageHint}</p>
            {page.cover ? <Button size="sm" variant="ghost" onClick={() => setPage({ ...page, cover: "" })}>{t.removeCover}</Button> : <p className="text-xs text-muted">{t.noCover}</p>}
          </div>
          {!page.blocks.length && <p className="text-sm text-muted">{t.empty}</p>}
          <div className="space-y-3 rounded-xl border border-line p-4"><h3 className="text-sm font-medium">{t.listing}</h3>
            <p className="text-xs text-muted">{t.listingHint}</p>{picker(listing.cover, "listing")}
            {listing.cover && <Button size="sm" variant="ghost" onClick={() => setPage({ ...page, listing: { ...listing, cover: "" } })}>{t.reuseCover}</Button>}
            <label className="grid gap-1 text-sm">{t.summary}<textarea className={field} rows={2} maxLength={200} value={listing.summary} onChange={e => setPage({ ...page, listing: { ...listing, summary: e.target.value } })} /></label>
            <label className="grid gap-1 text-sm">{t.sortOrder}<input className={field} type="number" min={-9999} max={9999} value={listing.sortOrder} onChange={e => setPage({ ...page, listing: { ...listing, sortOrder: Number(e.target.value) } })} /></label>
            <div className="space-y-2"><span className="text-sm">{t.labels}</span>{listing.labels.map((value, index) => <div key={index} className="flex gap-2"><input aria-label={`${t.labels} ${index + 1}`} className={field} maxLength={24} value={value} onChange={e => setPage({ ...page, listing: { ...listing, labels: listing.labels.map((label, i) => i === index ? e.target.value : label) } })} /><Button size="sm" variant="ghost" onClick={() => setPage({ ...page, listing: { ...listing, labels: listing.labels.filter((_, i) => i !== index) } })}>{t.remove}</Button></div>)}
              <Button size="sm" variant="secondary" disabled={listing.labels.length >= 5} onClick={() => setPage({ ...page, listing: { ...listing, labels: [...listing.labels, ""] } })}>{t.addLabel}</Button></div>
          </div>
          <div className="space-y-3 rounded-xl border border-line p-4"><h3 className="text-sm font-medium">{t.signup}</h3><p className="text-xs text-muted">{t.signupHint}</p>
            {(["instructions", "confirmation", "success"] as const).map(key => <label key={key} className="grid gap-1 text-sm">{t[key]}<textarea className={field} rows={3} maxLength={key === "confirmation" ? 500 : 2000} value={signup[key]} onChange={e => setPage({ ...page, signup: { ...signup, [key]: e.target.value } })} /></label>)}
          </div>
          {page.blocks.map((block, index) => <div key={block.id} className="space-y-4 rounded-xl border border-line p-4">
            <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-medium">{index + 1} · {t[block.type]}</h3><div className="flex flex-wrap gap-1">
              <Button size="sm" variant="ghost" disabled={index === 0} onClick={() => move(index, -1)}>{t.up}</Button>
              <Button size="sm" variant="ghost" disabled={index === page.blocks.length - 1} onClick={() => move(index, 1)}>{t.down}</Button>
              <Button size="sm" variant="ghost" onClick={() => setPage({ ...page, blocks: page.blocks.filter(b => b.id !== block.id) })}>{t.remove}</Button>
            </div></div>
            {block.type !== "text" && picker(block.imagePath, block.id)}
            {block.type === "imageText" && <label className="grid gap-1 text-sm">{t.position}<select className={field} value={block.position} onChange={e => patchBlock(block.id, { position: e.target.value as "above" | "left" | "right" })}>
              <option value="above">{t.above}</option><option value="left">{t.left}</option><option value="right">{t.right}</option>
            </select></label>}
            {block.type !== "image" ? <><label className="grid gap-1 text-sm">{t.heading}<input className={field} maxLength={120} value={block.title} onChange={e => patchBlock(block.id, { title: e.target.value })} /></label>
              <label className="grid gap-1 text-sm">{t.body}<textarea className={field} rows={5} maxLength={6000} value={block.body} onChange={e => patchBlock(block.id, { body: e.target.value })} /></label></>
              : <label className="grid gap-1 text-sm">{t.caption}<input className={field} maxLength={300} value={block.caption} onChange={e => patchBlock(block.id, { caption: e.target.value })} /></label>}
          </div>)}
          <div className="space-y-2"><span className="text-sm">{t.add}</span><div className="flex flex-wrap gap-2">{(["text", "image", "imageText"] as const).map(type => <Button key={type} size="sm" variant="secondary" disabled={page.blocks.length >= 30} onClick={() => add(type)}>+ {t[type]}</Button>)}</div>
            {page.blocks.length >= 30 && <p className="text-xs text-muted">{t.limit}</p>}</div>
          <div className="flex flex-wrap gap-3 border-t border-line pt-5"><Button variant="secondary" disabled={conflict} onClick={() => void save(false)}>{t.save}</Button><Button disabled={conflict} onClick={() => void save(true)}>{t.publish}</Button></div>
        </fieldset>
        <ActivityPagePreview page={page} title={title} locale={locale} />
      </div>
      {!!state.history.length && <div className="mt-6 space-y-3 border-t border-line pt-5"><h3 className="text-sm font-medium">{t.history}</h3><p className="text-xs text-muted">{t.historyHint}</p>
        {state.history.map(item => <div key={item.revision} className="flex items-center justify-between gap-3 text-sm"><span>v{item.revision} · {new Date(item.publishedAt).toLocaleString(locale)}</span><Button size="sm" variant="secondary" disabled={!!busy || dirty || conflict} onClick={() => void restore(item.revision)}>{t.restore}</Button></div>)}
      </div>}
    </>}
  </DashboardSection>;
}
