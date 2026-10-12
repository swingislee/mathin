"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { miniappText } from "../../../../contracts/participant-api/miniapp-settings";
import { LocalizedField, settingsField } from "./fields";
import { loadMiniappDocument, loadMiniappDocuments, restoreMiniappDocument, saveMiniappDocument } from "./document-actions";
import type { DocumentContent, DocumentIndex, DocumentState } from "./document-contract";

const blank = (): DocumentContent => ({ title: { zh: "", en: "" }, body: { zh: "", en: "" }, enabled: true });
export function MiniappDocumentsEditor({ initialIndex, initial, locale }: { initialIndex: DocumentIndex; initial: DocumentState; locale: "zh" | "en" }) {
  const en = locale === "en", [index, setIndex] = useState(initialIndex), [state, setState] = useState(initial), [content, setContent] = useState(initial.draft);
  const [baseline, setBaseline] = useState(JSON.stringify(initial.draft)), [newId, setNewId] = useState(""), [notice, setNotice] = useState(""), [busy, start] = useTransition();
  const [conflict, setConflict] = useState(false), requestVersion = useRef(0), dirty = baseline !== JSON.stringify(content);
  const policy = ["privacy", "children_privacy"].includes(state.id);
  useEffect(() => { if (!dirty) return; const warn = (e: BeforeUnloadEvent) => e.preventDefault(); window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [dirty]);
  const failure = (code: string) => code === "FORM_CHANGED" ? (en ? "Another edit was saved. Your input is kept; reload to review the current draft." : "已有其他修改保存。当前输入已保留，请重新载入后核对。") : (en ? "Could not save. Check the document ID and content, then retry." : "未能完成，请核对文档标识与内容后重试。");
  function accept(value: DocumentState) { setState(value); setContent(value.draft); setBaseline(JSON.stringify(value.draft)); setConflict(false); }
  function run(work: () => Promise<void>) { start(async () => { try { await work(); } catch { setNotice(failure("UNAVAILABLE")); } }); }
  async function refreshIndex() { const r = await loadMiniappDocuments(); if (r.ok) setIndex(r.data); }
  function choose(id: string, discard = false) {
    if (!discard && dirty && !window.confirm(en ? "Discard unsaved changes?" : "放弃尚未保存的修改？")) return;
    const version = ++requestVersion.current;
    run(async () => { const r = await loadMiniappDocument(id); if (version !== requestVersion.current) return; if (r.ok) { accept(r.data); setNotice(""); } else setNotice(failure(r.code)); });
  }
  function create() {
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(newId) || index.some(d => d.id === newId)) { setNotice(en ? "Choose an unused ID with lowercase letters, numbers, hyphens or underscores." : "请使用未占用的小写字母、数字、连字符或下划线标识。" ); return; }
    if (dirty && !window.confirm(en ? "Discard unsaved changes?" : "放弃尚未保存的修改？")) return;
    requestVersion.current++; accept({ id: newId, draft: blank(), revision: 0, publishedRevision: null, history: [] }); setNewId(""); setNotice("");
  }
  function save(publish: boolean) { run(async () => {
    const r = await saveMiniappDocument(state.id, content, state.revision, publish);
    if (r.ok) { accept(r.data); await refreshIndex(); setNotice(publish ? (en ? "Published." : "已发布。") : (en ? "Draft saved." : "草稿已保存。")); }
    else { setNotice(failure(r.code)); setConflict(r.code === "FORM_CHANGED"); }
  }); }
  function restore(revision: number) { run(async () => { const r = await restoreMiniappDocument(state.id, revision, state.revision);
    if (r.ok) { accept(r.data); await refreshIndex(); setNotice(en ? "Restored as a draft. Publish when ready." : "已恢复为草稿，可预览后发布。" ); }
    else { setNotice(failure(r.code)); setConflict(r.code === "FORM_CHANGED"); }
  }); }
  return <div className="space-y-5">
    <div className="flex flex-wrap items-end gap-3"><label className="grid gap-1 text-sm">{en ? "Document" : "选择文档"}<select className={settingsField} disabled={busy} value={state.id} onChange={e => choose(e.target.value)}>{!index.some(d => d.id === state.id) && <option value={state.id}>{state.id}</option>}{index.map(d => <option key={d.id} value={d.id}>{miniappText(d.title, locale) || d.id} · {d.id}</option>)}</select></label>
      <label className="grid gap-1 text-sm">{en ? "New help document ID" : "新帮助文档标识"}<input className={settingsField} disabled={busy} maxLength={64} value={newId} onChange={e => setNewId(e.target.value)} placeholder="help-booking" /></label><Button disabled={busy} variant="secondary" onClick={create}>{en ? "Create" : "新建"}</Button></div>
    <div className="flex flex-wrap gap-3"><Button disabled={busy || conflict} variant="secondary" onClick={() => save(false)}>{en ? "Save draft" : "保存草稿"}</Button><Button disabled={busy || conflict} onClick={() => save(true)}>{en ? "Publish document" : "发布文档"}</Button>{conflict && <Button disabled={busy} variant="secondary" onClick={() => choose(state.id, true)}>{en ? "Reload" : "重新载入"}</Button>}<span className="self-center text-sm text-muted">{dirty ? (en ? "Unsaved changes" : "有未保存修改") : state.publishedRevision ? `${en ? "Published revision" : "已发布版本"} ${state.publishedRevision}` : (en ? "Draft" : "草稿")}</span></div>
    <p className="text-sm text-muted">{policy ? (en ? "Publishing creates a new consent version. Existing accounts will be asked to read and confirm it; prior decisions and text stay available." : "发布会生成新的条款版本，已有账号将收到阅读与确认入口；旧确认记录与旧正文继续保留。") : (en ? `Use “Document” in Home or Menus with target ${state.id}.` : `在首页或服务入口中选择“文档”，目标填写 ${state.id}。`)}</p>
    {notice && <p role="status" className="text-sm">{notice}</p>}
    <fieldset disabled={busy} className="grid items-start gap-6 lg:grid-cols-2"><div className="space-y-4"><LocalizedField label={en ? "Title" : "标题"} max={120} value={content.title} onChange={title => setContent(v => ({ ...v, title }))} /><LocalizedField label={en ? "Body" : "正文"} max={20000} multiline value={content.body} onChange={body => setContent(v => ({ ...v, body }))} />{!policy && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={content.enabled} onChange={e => setContent(v => ({ ...v, enabled: e.target.checked }))} />{en ? "Public after publishing" : "发布后公开"}</label>}</div>
      <article className="rounded-xl border border-line bg-card p-5"><h2 className="font-display text-xl">{miniappText(content.title, locale)}</h2><p className="mt-4 whitespace-pre-wrap break-words text-sm leading-7">{miniappText(content.body, locale)}</p></article></fieldset>
    <div className="divide-y divide-line">{state.history.map(h => <div key={h.revision} className="flex items-center justify-between gap-3 py-3"><span className="text-sm">{h.version} · {new Date(h.publishedAt).toLocaleString(locale)}</span><Button variant="secondary" size="sm" disabled={busy || dirty || conflict} onClick={() => restore(h.revision)}>{en ? "Restore as draft" : "恢复为草稿"}</Button></div>)}</div>
  </div>;
}
