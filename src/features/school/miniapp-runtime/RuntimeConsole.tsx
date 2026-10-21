"use client";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useTransition } from "react";
import {
  ArrowDown, ArrowUp, Award, BarChart3, CalendarDays, ChevronsDownUp, ClipboardList, FileText, Gauge, IdCard, ImageIcon, LayoutGrid, LayoutPanelTop, List, Minus, MousePointerClick,
  Music, PanelBottom, PanelTop, Plus, Redo2, SlidersHorizontal, SquareStack, Table2, Trash2, TrendingUp, Type, Undo2, UserRound, Users, Video, type LucideIcon,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { addRewardScreens } from "@/features/participant-portal/rewards/screens";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePanelLayout } from "@/hooks/use-panel-layout";
import { cn } from "@/lib/utils";
import { DashboardCommandActions, DashboardCommandPanel, DashboardPage } from "@/features/school/dashboard-page";
import { loadMiniappSettings, saveMiniappSettings, uploadMiniappImage } from "@/features/school/miniapp-settings/actions";
import type { SettingsState } from "@/features/school/miniapp-settings/contract";
import { localText } from "../../../../contracts/participant-api/miniapp-experience";
import { defaultMiniappExperience } from "../../../../contracts/participant-api/miniapp-experience-templates";
import { settingsExperienceIssues } from "../../../../contracts/participant-api/miniapp-experience-validation";
import { defaultMiniappSettings, type MiniappSettings } from "../../../../contracts/participant-api/miniapp-settings";
import { runtimeChildren, runtimeTabSlots, type RuntimeBlockType, type RuntimeScreen, type RuntimeSpec, type RuntimeTab, type RuntimeTabSpec } from "../../../../contracts/participant-api/runtime";
import { loadMiniappRuntime, previewMiniappRuntime, restoreMiniappRuntime, saveMiniappRuntime, type RuntimeWorkbench } from "./actions";
import { BlockInspector, OpenLibrary, ScreenInspector } from "./Inspector";
import { Breadcrumb, InsertMenu, LibraryCanvas, LibraryInsert, LibraryInspector, LibraryList, partTitle, type ContactOptions, type LibraryUpload } from "./Library";
import { RuntimePhone } from "./RuntimeRenderer";
import {
  blockNames, blockSummary, canHideTab, changes, findBlock, insertBlock, libraryItems, libraryNames, moveBlock, newBlock, newScreen, outline, removeBlock, settingsChanges,
  updateBlock, withHidden, type LibraryTarget, type Locale,
} from "./model";

const header = "h-11 min-h-11 max-h-11 shrink-0 border-b border-line";
const icons: Record<RuntimeBlockType, LucideIcon> = {
  section: SquareStack, tabs: PanelTop, collapse: ChevronsDownUp, text: Type, image: ImageIcon, feature: LayoutPanelTop, entries: LayoutGrid, filters: SlidersHorizontal,
  list: List, calendar: CalendarDays, participants: Users, account: UserRound, content: FileText, form: ClipboardList, card: IdCard, metrics: Gauge, chart: BarChart3,
  progress: TrendingUp, badges: Award, table: Table2, video: Video, audio: Music, button: MousePointerClick, bar: PanelBottom, divider: Minus,
};
/** The insert menu groups blocks by what they are for; the most used ones also sit on the toolbar. */
const toolGroups: { zh: string; en: string; types: RuntimeBlockType[] }[] = [
  { zh: "文字与图片", en: "Text & media", types: ["text", "image", "feature", "button", "content", "video", "audio", "divider"] },
  { zh: "入口与布局", en: "Layout", types: ["section", "entries", "tabs", "collapse", "bar"] },
  { zh: "孩子与数据", en: "Family data", types: ["list", "calendar", "participants", "account", "filters", "card", "metrics", "chart", "progress", "badges", "table"] },
  { zh: "填写与提交", en: "Forms", types: ["form"] },
];
const quickTools: RuntimeBlockType[] = ["text", "image", "button", "entries", "list", "form"];
const withExperience = (value: MiniappSettings | null): MiniappSettings => { const config = value ?? defaultMiniappSettings(); return { ...config, experience: config.experience || defaultMiniappExperience(config) }; };

/** Pages and the settings they use form one draft with one undo history; each part is saved to its own store. */
type Doc = { spec: RuntimeSpec; settings: MiniappSettings };
type SaveState = "saved" | "pending" | "saving" | "invalid" | "conflict" | "error";
type History = { doc: Doc; past: Doc[]; future: Doc[]; edits: number };
type HistoryAction = { type: "edit"; change: (doc: Doc) => Doc } | { type: "undo" } | { type: "redo" } | { type: "reset"; doc: Doc } | { type: "restore"; spec: RuntimeSpec };
function history(state: History, action: HistoryAction): History {
  switch (action.type) {
    case "edit": { const doc = action.change(state.doc); return doc === state.doc ? state : { doc, past: [...state.past.slice(-49), state.doc], future: [], edits: state.edits + 1 }; }
    case "undo": return state.past.length ? { doc: state.past[state.past.length - 1], past: state.past.slice(0, -1), future: [state.doc, ...state.future], edits: state.edits + 1 } : state;
    case "redo": return state.future.length ? { doc: state.future[0], past: [...state.past, state.doc], future: state.future.slice(1), edits: state.edits + 1 } : state;
    case "reset": return { doc: action.doc, past: [], future: [], edits: state.edits };
    case "restore": return { doc: { ...state.doc, spec: action.spec }, past: [...state.past, state.doc], future: [], edits: state.edits };
  }
}

/** Mini Program workbench. The canvas is the first layer: pages on the left, the real rendering in the middle, the selected object's properties on the right.
 * Settings that pages depend on (names, stages, contacts, rules, content pages, forms, reports) open one level deeper and return to the canvas. */
export function MiniappRuntimeConsole({ initial, settings: initialSettings, liveSettings: initialLive, contactOptions, activities, locale }: {
  initial: RuntimeWorkbench; settings: SettingsState; liveSettings: MiniappSettings; contactOptions?: ContactOptions; activities: { id: string; title: string }[]; locale: Locale;
}) {
  const zh = locale === "zh", L = (a: string, b: string) => zh ? a : b;
  const [bench, setBench] = useState(initial);
  const [liveSettings, setLiveSettings] = useState(() => withExperience(initialLive));
  const [initialDoc] = useState<Doc>(() => ({ spec: initial.draft, settings: withExperience(initialSettings.draft) }));
  const [{ doc, past, future, edits }, dispatch] = useReducer(history, { doc: initialDoc, past: [], future: [], edits: 0 });
  const { spec } = doc;
  const [screenId, setScreenId] = useState(initial.draft.tabs[0]?.screen ?? initial.draft.screens[0]?.id ?? "");
  const [blockId, setBlockId] = useState("");
  /** The tab shown on the canvas for each tabs block; new blocks go into it. */
  const [openTabs, setOpenTabs] = useState<Record<string, string>>({});
  const [editLocale, setEditLocale] = useState<Locale>("zh");
  const [mode, setMode] = useState<"visitor" | "member">("member");
  const [preview, setPreview] = useState<{ screen: RuntimeScreen; tabs: RuntimeTab[]; issues: string[] } | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved"), [savedEdits, setSavedEdits] = useState(0);
  const [publishOpen, setPublishOpen] = useState(false), [notice, setNotice] = useState("");
  const [side, setSide] = useState<"pages" | "library">("pages");
  const [library, setLibrary] = useState<LibraryTarget | null>(null), [trail, setTrail] = useState<string[]>([]), [part, setPart] = useState("");
  const [previewHost, setPreviewHost] = useState<HTMLElement | null>(null);
  const [pending, startTransition] = useTransition();
  const runtimeRevision = useRef(initial.revision), settingsRevision = useRef(initialSettings.revision);
  const saved = useRef<Doc>(initialDoc), current = useRef<Doc>(initialDoc), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { groupRef, onLayoutChanged } = usePanelLayout("miniapp-runtime-console");
  useEffect(() => { current.current = doc; }, [doc]);

  const setSpec = useCallback((change: (value: RuntimeSpec) => RuntimeSpec) => dispatch({ type: "edit", change: value => { const next = change(value.spec); return next === value.spec ? value : { ...value, spec: next }; } }), []);
  const setSettings = useCallback((change: (value: MiniappSettings) => MiniappSettings) => dispatch({ type: "edit", change: value => { const next = change(value.settings); return next === value.settings ? value : { ...value, settings: next }; } }), []);
  const undo = useCallback(() => dispatch({ type: "undo" }), []);
  const redo = useCallback(() => dispatch({ type: "redo" }), []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || (event.target instanceof HTMLElement && event.target.matches("input, textarea, select"))) return;
      if (event.key.toLowerCase() === "z") { event.preventDefault(); if (event.shiftKey) redo(); else undo(); }
      else if (event.key.toLowerCase() === "y") { event.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  const fail = (code: string) => setSaveState(code === "FORM_CHANGED" ? "conflict" : code === "VALIDATION" ? "invalid" : "error");
  // Drafts save automatically; publishing stays a separate decision.
  useEffect(() => {
    if (!edits || saveState === "conflict") return;
    const target = edits;
    timer.current = setTimeout(async () => {
      const value = current.current;
      setSaveState("saving");
      try {
        if (value.spec !== saved.current.spec) {
          const result = await saveMiniappRuntime(value.spec, runtimeRevision.current, false);
          if (!result.ok) { fail(result.code); return; }
          runtimeRevision.current = result.data.revision; setBench(result.data); saved.current = { ...saved.current, spec: value.spec };
        }
        if (value.settings !== saved.current.settings) {
          const result = await saveMiniappSettings(value.settings, settingsRevision.current, false);
          if (!result.ok) { fail(result.code); return; }
          settingsRevision.current = result.data.revision; saved.current = { ...saved.current, settings: value.settings };
        }
        setSavedEdits(target); setSaveState("saved");
      } catch { setSaveState("error"); }
    }, 1200);
    return () => clearTimeout(timer.current);
  }, [edits]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!screenId) return;
    const timer = setTimeout(async () => {
      const result = await previewMiniappRuntime(spec, screenId, mode, editLocale, { brand: doc.settings.brand, stages: doc.settings.stages, forms: doc.settings.experience?.forms });
      if (result.ok) setPreview(result.data);
    }, 350);
    return () => clearTimeout(timer);
  }, [spec, screenId, mode, editLocale, doc.settings.brand, doc.settings.stages, doc.settings.experience?.forms]);

  const screen = spec.screens.find(row => row.id === screenId) ?? spec.screens[0];
  const tab = spec.tabs.find(row => row.screen === screen?.id);
  const block = screen && blockId ? findBlock(screen.blocks, blockId) : null;
  const meta = useMemo(() => ({
    contentPages: (doc.settings.experience?.pages ?? []).filter(page => page.enabled && page.audience === "all" && page.purpose !== "report")
      .map(page => ({ id: page.id, title: page.title.zh || page.title.en || page.id })),
    stages: doc.settings.stages.flatMap(group => group.stages.map(stage => ({ stageNumber: stage.stageNumber, label: stage.label.zh, group: group.label.zh }))),
    forms: (doc.settings.experience?.forms ?? []).filter(form => form.enabled).map(form => ({ id: form.id, title: form.title.zh || form.title.en || form.id })),
  }), [doc.settings.experience?.pages, doc.settings.experience?.forms, doc.settings.stages]);
  // Blocks the current preview identity does not receive are dimmed in the outline.
  const shown = useMemo(() => {
    const ids = new Set<string>();
    const walk = (rows: RuntimeScreen["blocks"]) => rows.forEach(row => { ids.add(row.id); walk(runtimeChildren(row)); });
    if (preview) walk(preview.screen.blocks);
    return ids;
  }, [preview]);
  const screenTitle = (value: typeof screen) => value ? value.title[locale] || value.title.zh || spec.tabs.find(row => row.screen === value.id)?.label[locale] || value.id : "";
  const updateScreen = (change: (blocks: typeof screen.blocks) => typeof screen.blocks) => setSpec(value => ({ ...value, screens: value.screens.map(row => row.id === screen.id ? { ...row, blocks: change(row.blocks) } : row) }));
  const insert = (type: RuntimeBlockType) => {
    if (!screen) return;
    const value = newBlock(type);
    // A new form block starts with the first form, so the draft stays complete and saves.
    if (value.type === "form" && meta.forms[0]) value.formId = meta.forms[0].id;
    updateScreen(blocks => insertBlock(blocks, blockId, value, openTabs[blockId] ?? "")); setBlockId(value.id); };
  const addScreen = (slot?: RuntimeTabSpec["slot"]) => {
    const value = newScreen(spec.screens.length + 1);
    setSpec(current => ({ ...current, screens: [...current.screens, value],
      tabs: slot ? [...current.tabs, { slot, screen: value.id, label: { zh: "新导航", en: "New" }, icon: "task" }].sort((a, b) => a.slot - b.slot) : current.tabs }));
    setScreenId(value.id); setBlockId("");
  };
  const removeScreen = () => {
    if (!screen || spec.screens.length < 2 || (tab && !canHideTab(spec.tabs, tab.slot))) return;
    setSpec(current => ({ ...current, screens: current.screens.filter(row => row.id !== screen.id), tabs: current.tabs.filter(row => row.screen !== screen.id) }));
    setScreenId(spec.tabs.find(row => row.screen !== screen.id)?.screen ?? spec.screens.find(row => row.id !== screen.id)!.id); setBlockId("");
  };

  /** Opens a library object; `from` names where on the canvas it was opened from. */
  // Pages, forms and reports open their first item, so the preview always shows something to click.
  const withFirst = (target: LibraryTarget): LibraryTarget => target.id ? target : { ...target, id: libraryItems(doc.settings, target.kind)?.[0]?.id };
  const openLibrary = (target: LibraryTarget, from: string[] = []) => {
    setLibrary(withFirst(target)); setPart(""); setSide("library"); setTrail([...from, libraryNames[target.kind][locale]]);
    // Name and theme show on pages with the brand top bar.
    if (target.kind === "brand" && screen?.navigation !== "brand") { const first = spec.screens.find(row => row.navigation === "brand"); if (first) setScreenId(first.id); }
  };
  const moveInLibrary = (target: LibraryTarget) => { if (target.kind !== library?.kind) setTrail([libraryNames[target.kind][locale]]); setLibrary(withFirst(target)); setPart(""); };
  const backToCanvas = () => { setLibrary(null); setPart(""); setSide("pages"); };
  const openFromInspector = (target: LibraryTarget) => openLibrary(target, [screenTitle(screen), ...(block ? [blockSummary(block, locale) || blockNames[block.type][locale]] : [])]);
  const libraryItem = library?.id ? libraryItems(doc.settings, library.kind)?.find(row => row.id === library.id) : null;

  const upload: LibraryUpload = (file, accept, qr) => startTransition(async () => {
    const form = new FormData(); form.set("image", file); if (qr) form.set("kind", "qr");
    const result = await uploadMiniappImage(form);
    if (result.ok) accept(result.data.path); else setNotice(L("图片未能上传，请换一张 JPG/PNG 重试。", "Upload failed. Try another JPG/PNG."));
  });
  const reload = () => startTransition(async () => {
    const [runtime, settings] = await Promise.all([loadMiniappRuntime(), loadMiniappSettings()]);
    if (!runtime.ok || !settings.ok) { setNotice(L("读取失败，请稍后重试。", "Could not load. Try again.")); return; }
    runtimeRevision.current = runtime.data.revision; settingsRevision.current = settings.data.revision; setBench(runtime.data);
    const next = { spec: runtime.data.draft, settings: withExperience(settings.data.draft) };
    saved.current = next; dispatch({ type: "reset", doc: next }); setSavedEdits(edits); setSaveState("saved");
  });
  const runtimeChanges = changes(bench.live, spec, locale);
  const libraryChanges = settingsChanges(liveSettings, doc.settings, locale);
  const issues = libraryChanges.length ? settingsExperienceIssues(doc.settings) : [];
  // The first publication also switches clients from the settings pages to these pages.
  const publishRuntime = runtimeChanges.length > 0 || bench.fromSettings;
  const publish = () => startTransition(async () => {
    clearTimeout(timer.current);
    const value = current.current;
    if (libraryChanges.length) {
      const result = await saveMiniappSettings(value.settings, settingsRevision.current, true);
      if (!result.ok) { fail(result.code); setPublishOpen(false); setNotice(L("资料未能发布，请检查后重试。", "Settings were not published. Check and retry.")); return; }
      settingsRevision.current = result.data.revision; saved.current = { ...saved.current, settings: value.settings }; setLiveSettings(value.settings);
    }
    if (publishRuntime) {
      const result = await saveMiniappRuntime(value.spec, runtimeRevision.current, true);
      if (!result.ok) { fail(result.code); setPublishOpen(false); setNotice(L("页面未能发布，请重新读取后再试。", "Pages were not published. Reload and retry.")); return; }
      runtimeRevision.current = result.data.revision; setBench(result.data); saved.current = { ...saved.current, spec: value.spec };
    }
    setSavedEdits(edits); setSaveState("saved"); setPublishOpen(false);
    setNotice(L("已发布。小程序下次进入页面时读取新版本。", "Published. The Mini Program reads it on the next page visit."));
  });
  const restore = (source: number) => startTransition(async () => {
    const result = await restoreMiniappRuntime(source, runtimeRevision.current);
    if (!result.ok) { setNotice(L("恢复失败，请重新读取后再试。", "Restore failed. Reload and retry.")); return; }
    runtimeRevision.current = result.data.revision; setBench(result.data); saved.current = { ...saved.current, spec: result.data.draft }; dispatch({ type: "restore", spec: result.data.draft });
    setNotice(L(`已把第 ${source} 版页面恢复为草稿，确认后再发布。`, `Pages version ${source} restored as a draft.`));
  });
  const shownState: SaveState = saveState === "saved" && edits !== savedEdits ? "pending" : saveState;
  const status: Record<SaveState, string> = { saved: L("草稿已自动保存", "Draft saved"), pending: L("有修改", "Edited"), saving: L("正在保存…", "Saving…"),
    invalid: L("有内容未填完整，暂未保存", "Incomplete content not saved"), conflict: L("草稿已在别处更新", "Draft changed elsewhere"), error: L("保存失败，稍后自动重试", "Save failed") };

  const tabScreens = new Set(spec.tabs.map(row => row.screen));
  const directoryRow = (id: string, label: string, sub: string, active: boolean, onClick: () => void) =>
    <button type="button" key={id} onClick={onClick} className={cn("flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-moon/20", active && "bg-moon/30 font-medium")}>
      <span className="min-w-0 flex-1 truncate">{label}</span><span className="shrink-0 text-[11px] text-muted">{sub}</span></button>;
  // Unchecking hides a tab or block from the Mini Program while keeping it in the draft.
  const shownBox = (hidden: boolean, onChange: (hidden: boolean) => void, disabledReason?: string) =>
    <Checkbox checked={!hidden} disabled={!!disabledReason && !hidden} onCheckedChange={value => onChange(value !== true)} className="shrink-0"
      aria-label={L("在小程序中显示", "Show in the Mini Program")} title={disabledReason && !hidden ? disabledReason : hidden ? L("已隐藏，勾选后重新显示", "Hidden; check to show") : L("取消勾选即隐藏，不删除", "Uncheck to hide without deleting")} />;
  const setTabHidden = (slot: RuntimeTabSpec["slot"], hidden: boolean) => setSpec(value => ({ ...value, tabs: value.tabs.map(row => row.slot === slot ? withHidden(row, hidden) : row) }));
  const setBlockHidden = (id: string, hidden: boolean) => updateScreen(blocks => updateBlock(blocks, id, row => withHidden(row, hidden)));
  const showScreen = (id: string) => { setScreenId(id); setBlockId(""); if (library) backToCanvas(); };

  const historyButtons = <>
    <Button size="sm" variant="ghost" className="size-9 p-0" title={L("撤销 · Ctrl+Z", "Undo · Ctrl+Z")} aria-label={L("撤销", "Undo")} disabled={!past.length} onClick={undo}><Undo2 className="size-4" /></Button>
    <Button size="sm" variant="ghost" className="size-9 p-0" title={L("重做 · Ctrl+Shift+Z", "Redo")} aria-label={L("重做", "Redo")} disabled={!future.length} onClick={redo}><Redo2 className="size-4" /></Button>
  </>;
  const saveStatus = <>
    <span className={cn("shrink-0 px-2 text-xs", ["invalid", "error", "conflict"].includes(shownState) ? "text-rose" : "text-muted")}>{status[shownState]}</span>
    {saveState === "conflict" && <Button size="sm" variant="secondary" onClick={reload}>{L("重新读取", "Reload")}</Button>}
  </>;
  const phone = preview ? <RuntimePhone title={preview.screen.title} brand={preview.screen.navigation === "brand"} blocks={preview.screen.blocks} tabs={preview.tabs} activeScreen={screen?.id ?? ""}
    strings={editLocale === "zh" ? { signIn: "登录", today: "今", weekdays: "一,二,三,四,五,六,日", view: "查看", chooseParticipant: "选择参与人", signInNow: "点击登录", brandSettings: "点击修改名称与主题", more: "加载更多" }
      : { signIn: "Sign in", today: "Today", weekdays: "M,T,W,T,F,S,S", view: "View", chooseParticipant: "Choose participant", signInNow: "Sign in", brandSettings: "Edit name and theme", more: "Load more" }}
    selected={library ? "" : blockId} onSelect={library ? undefined : setBlockId} onTab={id => { setScreenId(id); setBlockId(""); }}
    onTitle={() => openLibrary({ kind: "brand" }, [screenTitle(screen)])} openTabs={openTabs} onOpenTab={(block, tab) => setOpenTabs(current => ({ ...current, [block]: tab }))} />
    : <p className="pt-20 text-center text-sm text-muted">{L("正在生成预览…", "Rendering preview…")}</p>;
  const ownPreview = library && ["pages", "forms", "reports"].includes(library.kind);

  return <OpenLibrary.Provider value={openFromInspector}><DashboardPage title={L("小程序", "Mini Program")} backHref="/dashboard/organization" backLabel={L("机构设置", "Organization")}
    commandPanel={<DashboardCommandPanel><DashboardCommandActions>
      <span className="text-sm text-muted">{bench.publishedAt ? `${L("最近发布", "Published")} ${new Date(bench.publishedAt).toLocaleString(locale)}` : bench.fromSettings ? L("尚未发布过页面", "Pages not yet published") : ""}</span>
      {bench.history.length > 0 && <select aria-label={L("页面历史版本", "Page history")} className="h-9 rounded-md border border-line bg-paper px-2 text-sm" value="" disabled={pending}
        onChange={event => event.target.value && restore(Number(event.target.value))}>
        <option value="">{L("页面历史版本…", "Page history…")}</option>{bench.history.map(row => <option key={row.revision} value={row.revision}>{L(`第 ${row.revision} 版`, `Version ${row.revision}`)} · {new Date(row.publishedAt).toLocaleString(locale)}</option>)}</select>}
      <Button disabled={pending || shownState === "conflict" || shownState === "invalid"} onClick={() => setPublishOpen(true)}>{L("发布", "Publish")}</Button>
      <Button variant="secondary" disabled={pending} onClick={() => { setSpec(addRewardScreens); setScreenId("learning-points"); setBlockId(""); setNotice(L("学习积分页面已加入草稿，发布后在「我的」显示入口。", "Points pages added to the draft. Publish to show the account entry.")); }}>{L("接入积分页面", "Add points pages")}</Button>
      <Link className={buttonVariants({ variant: "ghost" })} href="/dashboard/learning-rewards">{L("积分规则与账本", "Points rules and ledger")}</Link>
    </DashboardCommandActions></DashboardCommandPanel>}>
    {notice && <p role="status" className="mb-2 text-sm">{notice}</p>}
    <Card className="h-[calc(100dvh-9rem)] min-h-[34rem] overflow-hidden">
      <ResizablePanelGroup groupRef={groupRef} orientation="horizontal" onLayoutChanged={onLayoutChanged} className="size-full">
        <ResizablePanel id="directory" minSize={200} defaultSize={240} maxSize="40%" groupResizeBehavior="preserve-pixel-size" className="overflow-hidden">
          <nav aria-label={L("页面目录", "Pages")} className="flex size-full min-h-0 flex-col">
            <div className={cn(header, "flex items-center gap-2 px-2")}>
              <Tabs value={side} onValueChange={value => setSide(value as typeof side)} className="min-w-0 flex-1">
                <TabsList className="grid h-8 w-full grid-cols-2"><TabsTrigger value="pages" className="text-xs">{L("页面", "Pages")}</TabsTrigger><TabsTrigger value="library" className="text-xs">{L("资料", "Settings")}</TabsTrigger></TabsList></Tabs>
              {side === "pages" && <Button size="sm" variant="ghost" className="size-8 p-0" title={L("新建页面", "New page")} aria-label={L("新建页面", "New page")} onClick={() => addScreen()}><Plus className="size-4" /></Button>}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {side === "library" ? <LibraryList settings={doc.settings} target={library} part={part} options={contactOptions} locale={locale} onPart={setPart} onChange={setSettings}
                onOpen={target => library ? moveInLibrary(target) : openLibrary(target)} /> : <div className="py-2">
                <p className="px-3 pb-1 text-[11px] font-medium text-muted">{L("底部导航", "Tab bar")}</p>
                {runtimeTabSlots.map(slot => {
                  const row = spec.tabs.find(item => item.slot === slot), target = row && spec.screens.find(item => item.id === row.screen);
                  return row && target ? <div key={"tab-" + slot} className={cn("flex items-center gap-1 pl-3 hover:bg-moon/20", !library && screen?.id === target.id && !blockId && "bg-moon/30 font-medium")}>
                    {shownBox(!!row.hidden, hidden => setTabHidden(slot, hidden), canHideTab(spec.tabs, slot) ? undefined : slot === 1 ? L("第 1 项是打开小程序时的首页，不能隐藏", "Tab 1 opens first") : L("底部导航至少显示两项", "Keep two tabs shown"))}
                    <button type="button" onClick={() => showScreen(target.id)} className={cn("flex min-w-0 flex-1 items-center gap-2 py-2 pl-1 pr-3 text-left text-sm", row.hidden && "opacity-45")}>
                      <span className="min-w-0 flex-1 truncate">{`${slot} · ${row.label[locale] || row.label.zh}`}</span>
                      <span className="shrink-0 text-[11px] text-muted">{row.hidden ? L("已隐藏", "Hidden") : row.visibleWhen ? L("有条件", "Rule") : ""}</span></button></div>
                    : spec.tabs.length < 5 && <button type="button" key={"tab-" + slot} onClick={() => addScreen(slot)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-muted hover:bg-moon/20"><Plus className="size-3.5" />{L(`第 ${slot} 项：添加导航`, `Add tab ${slot}`)}</button>;
                })}
                <p className="px-3 pb-1 pt-3 text-[11px] font-medium text-muted">{L("其他页面", "Other pages")}</p>
                {spec.screens.filter(row => !tabScreens.has(row.id)).map(row => directoryRow(row.id, row.title[locale] || row.title.zh || row.id, "", !library && screen?.id === row.id && !blockId, () => showScreen(row.id)))}
                {screen && <div className="mt-3 border-t border-line pt-2">
                  <p className="px-3 pb-1 text-[11px] font-medium text-muted">{L("本页组成", "On this page")} · {screenTitle(screen)}</p>
                  {outline(screen.blocks).map(({ block: row, depth }) => <div key={row.id} style={{ paddingLeft: 12 + depth * 14 }}
                    className={cn("flex items-center gap-1 hover:bg-moon/20", !library && blockId === row.id && "bg-crater/15 font-medium")}>
                    {shownBox(!!row.hidden, hidden => setBlockHidden(row.id, hidden))}
                    <button type="button" onClick={() => { setBlockId(row.id); if (library) backToCanvas(); }} title={row.hidden ? L("已隐藏，小程序里不显示", "Hidden from the Mini Program") : preview && !shown.has(row.id) ? L("当前预览身份看不到这一项", "Hidden for this preview identity") : undefined}
                      className={cn("flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-1 pr-3 text-left text-xs", (row.hidden || (preview && !shown.has(row.id))) && "opacity-45")}>
                      <span className="shrink-0 text-muted">{blockNames[row.type][locale]}</span><span className="truncate">{blockSummary(row, locale)}</span>
                      {(row.hidden || row.visibleWhen) && <span className="ml-auto shrink-0 text-[10px] text-muted">{row.hidden ? L("已隐藏", "Hidden") : L("条件", "Rule")}</span>}</button></div>)}
                </div>}
              </div>}
            </div>
          </nav>
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel id="canvas" minSize={420} className="overflow-hidden">
          {library ? <div className="flex size-full min-h-0 flex-col">
            <div className={cn(header, "flex items-center gap-1 px-2")}>
              {historyButtons}<span className="mx-1 h-5 w-px bg-line" />
              <Breadcrumb trail={libraryItem ? [...trail, localText(libraryItem.title, locale) || L("未命名", "Untitled")] : trail} locale={locale} onBack={backToCanvas} />
              {saveStatus}
              <Button size="sm" variant="secondary" className="shrink-0" onClick={backToCanvas}>{L("返回画布", "Back to canvas")}</Button>
            </div>
            <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1.5">
              <LibraryInsert target={library} settings={doc.settings} part={part} options={contactOptions} locale={locale} onChange={setSettings} onPart={setPart} />
            </div>
            <div className="min-h-0 flex-1 overflow-auto bg-moon/10 p-4">
              <LibraryCanvas target={library} settings={doc.settings} part={part} options={contactOptions} locale={locale} canvas={phone} onPart={setPart} previewHost={setPreviewHost} />
            </div>
          </div> : <div className="flex size-full min-h-0 flex-col">
            <div role="toolbar" aria-label={L("插入组件", "Insert")} className={cn(header, "flex items-center gap-1 px-2")}>
              {historyButtons}<span className="mx-1 h-5 w-px bg-line" />
              <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
                <InsertMenu wide label={L("插入组件", "Insert")}>{close => <div className="grid gap-3">{toolGroups.map(group => <div key={group.en}>
                  <p className="px-1 pb-1 text-[11px] font-medium text-muted">{group[locale]}</p>
                  <div className="grid grid-cols-3 gap-1">{group.types.map(type => { const Icon = icons[type]; return <button key={type} type="button"
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-moon/20" onClick={() => { insert(type); close(); }}>
                    <Icon className="size-4 shrink-0 text-muted" />{blockNames[type][locale]}</button>; })}</div></div>)}
                  <p className="px-1 text-[11px] text-muted">{L("插入到选中组件之后；选中区段、折叠分组或标签页时插入到里面。", "Inserted after the selected block, or inside a selected container.")}</p></div>}</InsertMenu>
                <span className="mx-1 h-5 w-px shrink-0 bg-line" />
                {quickTools.map(type => { const Icon = icons[type]; return <Button key={type} size="sm" variant="ghost" className="size-9 shrink-0 p-0"
                  title={L(`插入${blockNames[type].zh}`, `Insert ${blockNames[type].en}`)} aria-label={blockNames[type][locale]} onClick={() => insert(type)}><Icon className="size-4" /></Button>; })}</div>
              {saveStatus}
            </div>
            <div className="flex shrink-0 items-center justify-center gap-4 border-b border-line px-3 py-1.5 text-xs">
              <span className="flex items-center gap-1"><span className="text-muted">{L("预览身份", "Preview as")}</span>
                {(["visitor", "member"] as const).map(value => <button type="button" key={value} onClick={() => setMode(value)} className={cn("rounded-full px-2.5 py-0.5", mode === value ? "bg-crater/15 text-ink" : "text-muted")}>
                  {value === "visitor" ? L("未登录访客", "Visitor") : L("已登录家长（示例数据）", "Signed-in family (examples)")}</button>)}</span>
              <span className="flex items-center gap-1"><span className="text-muted">{L("编辑语言", "Language")}</span>
                {(["zh", "en"] as const).map(value => <button type="button" key={value} onClick={() => setEditLocale(value)} className={cn("rounded-full px-2.5 py-0.5", editLocale === value ? "bg-crater/15 text-ink" : "text-muted")}>{value === "zh" ? "中文" : "English"}</button>)}</span>
            </div>
            <div className="min-h-0 flex-1 overflow-auto bg-moon/10 p-4">
              {phone}
              {preview && preview.issues.length > 0 && <ul className="mx-auto mt-3 max-w-[375px] space-y-1 text-xs text-rose">{preview.issues.slice(0, 5).map(issue => <li key={issue}>{issue}</li>)}</ul>}
            </div>
          </div>}
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel id="inspector" minSize={280} defaultSize={330} maxSize="45%" groupResizeBehavior="preserve-pixel-size" className="overflow-hidden">
          {library ? <div className="flex size-full min-h-0 flex-col">
            <div className={cn(header, "flex items-center gap-1 px-3")}>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{partTitle(doc.settings, library, part, contactOptions, locale)}</span>
              {part && <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => setPart("")}>{L("整体设置", "Overall")}</Button>}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <LibraryInspector target={library} part={part} settings={doc.settings} options={contactOptions} activities={activities} locale={locale}
                previewHost={ownPreview ? previewHost : null} upload={upload} onChange={setSettings} onOpen={moveInLibrary} onPart={setPart} />
            </div>
          </div> : <div className="flex size-full min-h-0 flex-col">
            <div className={cn(header, "flex items-center gap-1 px-3")}>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{block ? blockNames[block.type][locale] : L("页面属性", "Page")}</span>
              {block ? <>
                <Button size="sm" variant="ghost" className="size-8 p-0" title={L("上移", "Move up")} aria-label={L("上移", "Move up")} onClick={() => updateScreen(blocks => moveBlock(blocks, block.id, -1))}><ArrowUp className="size-4" /></Button>
                <Button size="sm" variant="ghost" className="size-8 p-0" title={L("下移", "Move down")} aria-label={L("下移", "Move down")} onClick={() => updateScreen(blocks => moveBlock(blocks, block.id, 1))}><ArrowDown className="size-4" /></Button>
                <Button size="sm" variant="ghost" className="size-8 p-0" title={L("删除", "Delete")} aria-label={L("删除", "Delete")} onClick={() => { updateScreen(blocks => removeBlock(blocks, block.id)); setBlockId(""); }}><Trash2 className="size-4" /></Button>
              </> : screen && <Button size="sm" variant="ghost" className="size-8 p-0" title={tab ? L("移出底部导航并删除页面", "Remove tab and page") : L("删除页面", "Delete page")} aria-label={L("删除页面", "Delete page")}
                disabled={spec.screens.length < 2 || (!!tab && !canHideTab(spec.tabs, tab.slot))} onClick={removeScreen}><Trash2 className="size-4" /></Button>}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {block && screen ? <BlockInspector key={block.id + editLocale} block={block} screens={spec.screens} meta={meta} locale={editLocale}
                onChange={value => updateScreen(blocks => updateBlock(blocks, block.id, () => value))} />
                : screen && <ScreenInspector key={screen.id + editLocale} screen={screen} tab={tab} tabs={spec.tabs} screens={spec.screens} meta={meta} locale={editLocale}
                  onScreen={value => setSpec(current => ({ ...current, screens: current.screens.map(row => row.id === value.id ? value : row) }))}
                  onTab={value => setSpec(current => ({ ...current, tabs: current.tabs.map(row => row.slot === value.slot ? value : row) }))} />}
            </div>
          </div>}
        </ResizablePanel>
      </ResizablePanelGroup>
    </Card>
    <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
      <DialogContent>
        <DialogHeader><DialogTitle>{L("发布到小程序", "Publish to the Mini Program")}</DialogTitle>
          <DialogDescription>{L("页面和资料一起发布。家长下次进入页面即看到新版本，不需要重新上传小程序。", "Pages and settings publish together. Families see them on their next page visit; no Mini Program upload is needed.")}</DialogDescription></DialogHeader>
        {runtimeChanges.length + libraryChanges.length ? <ul className="list-disc space-y-1 pl-5 text-sm">{[...runtimeChanges, ...libraryChanges].map(row => <li key={row}>{row}</li>)}</ul>
          : <p className="text-sm text-muted">{L("与当前客户端看到的内容相同。", "Same as what clients see now.")}</p>}
        {issues.length > 0 && <div className="space-y-1 rounded-md border border-rose/40 p-3 text-sm"><p className="font-medium">{L(`资料里有 ${issues.length} 项需要先补齐`, `${issues.length} settings items need attention`)}</p>
          <ul className="list-disc pl-5 text-xs text-muted">{issues.slice(0, 6).map((issue, index) => <li key={index}>{issue[locale]}</li>)}</ul></div>}
        <DialogFooter><Button variant="secondary" onClick={() => setPublishOpen(false)}>{L("取消", "Cancel")}</Button>
          <Button disabled={pending || issues.length > 0 || (!publishRuntime && !libraryChanges.length)} onClick={publish}>{L("确认发布", "Publish")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </DashboardPage></OpenLibrary.Provider>;
}
