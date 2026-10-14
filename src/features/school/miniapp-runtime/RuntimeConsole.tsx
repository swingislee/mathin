"use client";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useTransition } from "react";
import {
  ArrowDown, ArrowUp, CalendarDays, FileText, ImageIcon, LayoutGrid, LayoutPanelTop, List, Minus, MousePointerClick, Plus, Redo2, SlidersHorizontal, SquareStack, Trash2, Type, Undo2, UserRound, Users,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { usePanelLayout } from "@/hooks/use-panel-layout";
import { cn } from "@/lib/utils";
import { DashboardCommandActions, DashboardCommandPanel, DashboardPage } from "@/features/school/dashboard-page";
import { runtimeTabSlots, type RuntimeBlockType, type RuntimeScreen, type RuntimeSpec, type RuntimeTab, type RuntimeTabSpec } from "../../../../contracts/participant-api/runtime";
import { loadMiniappRuntime, previewMiniappRuntime, restoreMiniappRuntime, saveMiniappRuntime, type RuntimeWorkbench } from "./actions";
import { BlockInspector, ScreenInspector } from "./Inspector";
import { RuntimePhone } from "./RuntimeRenderer";
import {
  blockNames, blockSummary, canHideTab, changes, findBlock, insertBlock, moveBlock, newBlock, newScreen, outline, removeBlock, updateBlock, withHidden, type Locale,
} from "./model";

const header = "h-11 min-h-11 max-h-11 shrink-0 border-b border-line";
const tools: { type: RuntimeBlockType; icon: LucideIcon }[] = [
  { type: "section", icon: SquareStack }, { type: "text", icon: Type }, { type: "image", icon: ImageIcon }, { type: "feature", icon: LayoutPanelTop },
  { type: "entries", icon: LayoutGrid }, { type: "filters", icon: SlidersHorizontal }, { type: "list", icon: List }, { type: "calendar", icon: CalendarDays }, { type: "participants", icon: Users },
  { type: "account", icon: UserRound }, { type: "content", icon: FileText }, { type: "button", icon: MousePointerClick }, { type: "divider", icon: Minus },
];
type SaveState = "saved" | "pending" | "saving" | "invalid" | "conflict" | "error";
type History = { spec: RuntimeSpec; past: RuntimeSpec[]; future: RuntimeSpec[]; edits: number };
type HistoryAction = { type: "edit"; change: (spec: RuntimeSpec) => RuntimeSpec } | { type: "undo" } | { type: "redo" } | { type: "reset"; spec: RuntimeSpec } | { type: "restore"; spec: RuntimeSpec };
function history(state: History, action: HistoryAction): History {
  switch (action.type) {
    case "edit": { const spec = action.change(state.spec); return spec === state.spec ? state : { spec, past: [...state.past.slice(-49), state.spec], future: [], edits: state.edits + 1 }; }
    case "undo": return state.past.length ? { spec: state.past[state.past.length - 1], past: state.past.slice(0, -1), future: [state.spec, ...state.future], edits: state.edits + 1 } : state;
    case "redo": return state.future.length ? { spec: state.future[0], past: [...state.past, state.spec], future: state.future.slice(1), edits: state.edits + 1 } : state;
    case "reset": return { spec: action.spec, past: [], future: [], edits: state.edits };
    case "restore": return { spec: action.spec, past: [...state.past, state.spec], future: [], edits: state.edits };
  }
}

/** Mini Program workbench: pages on the left, the real rendering in the middle, the selected object's properties on the right. */
export function MiniappRuntimeConsole({ initial, locale }: { initial: RuntimeWorkbench; locale: Locale }) {
  const zh = locale === "zh", L = (a: string, b: string) => zh ? a : b;
  const [bench, setBench] = useState(initial);
  const [{ spec, past, future, edits }, dispatch] = useReducer(history, { spec: initial.draft, past: [], future: [], edits: 0 });
  const [screenId, setScreenId] = useState(initial.draft.tabs[0]?.screen ?? initial.draft.screens[0]?.id ?? "");
  const [blockId, setBlockId] = useState("");
  const [editLocale, setEditLocale] = useState<Locale>("zh");
  const [mode, setMode] = useState<"visitor" | "member">("member");
  const [preview, setPreview] = useState<{ screen: RuntimeScreen; tabs: RuntimeTab[]; issues: string[] } | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved"), [savedEdits, setSavedEdits] = useState(0);
  const [publishOpen, setPublishOpen] = useState(false), [notice, setNotice] = useState("");
  const [pending, startTransition] = useTransition();
  const revision = useRef(initial.revision);
  const { groupRef, onLayoutChanged } = usePanelLayout("miniapp-runtime-console");

  const setSpec = useCallback((change: (current: RuntimeSpec) => RuntimeSpec) => dispatch({ type: "edit", change }), []);
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

  // Drafts save automatically; publishing stays a separate decision.
  useEffect(() => {
    if (!edits || saveState === "conflict") return;
    const target = edits;
    const timer = setTimeout(async () => {
      setSaveState("saving");
      const result = await saveMiniappRuntime(spec, revision.current, false);
      if (result.ok) { revision.current = result.data.revision; setBench(result.data); setSavedEdits(target); setSaveState("saved"); }
      else setSaveState(result.code === "FORM_CHANGED" ? "conflict" : result.code === "VALIDATION" ? "invalid" : "error");
    }, 1200);
    return () => clearTimeout(timer);
  }, [edits]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!screenId) return;
    const timer = setTimeout(async () => {
      const result = await previewMiniappRuntime(spec, screenId, mode, editLocale);
      if (result.ok) setPreview(result.data);
    }, 350);
    return () => clearTimeout(timer);
  }, [spec, screenId, mode, editLocale]);

  const screen = spec.screens.find(row => row.id === screenId) ?? spec.screens[0];
  const tab = spec.tabs.find(row => row.screen === screen?.id);
  const block = screen && blockId ? findBlock(screen.blocks, blockId) : null;
  const meta = useMemo(() => ({ contentPages: bench.contentPages, stages: bench.stages }), [bench.contentPages, bench.stages]);
  // Blocks the current preview identity does not receive are dimmed in the outline.
  const shown = useMemo(() => {
    const ids = new Set<string>();
    const walk = (rows: RuntimeScreen["blocks"]) => rows.forEach(row => { ids.add(row.id); if (row.type === "section") walk(row.blocks); });
    if (preview) walk(preview.screen.blocks);
    return ids;
  }, [preview]);
  const updateScreen = (change: (blocks: typeof screen.blocks) => typeof screen.blocks) => setSpec(current => ({ ...current, screens: current.screens.map(row => row.id === screen.id ? { ...row, blocks: change(row.blocks) } : row) }));
  const insert = (type: RuntimeBlockType) => { if (!screen) return; const value = newBlock(type); updateScreen(blocks => insertBlock(blocks, blockId, value)); setBlockId(value.id); };
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
  const reload = () => startTransition(async () => {
    const result = await loadMiniappRuntime();
    if (!result.ok) { setNotice(L("读取失败，请稍后重试。", "Could not load. Try again.")); return; }
    revision.current = result.data.revision; setBench(result.data); dispatch({ type: "reset", spec: result.data.draft }); setSavedEdits(edits); setSaveState("saved");
  });
  const publish = () => startTransition(async () => {
    const result = await saveMiniappRuntime(spec, revision.current, true);
    if (!result.ok) { setSaveState(result.code === "FORM_CHANGED" ? "conflict" : result.code === "VALIDATION" ? "invalid" : "error"); setPublishOpen(false); return; }
    revision.current = result.data.revision; setBench(result.data); setSavedEdits(edits); setSaveState("saved"); setPublishOpen(false);
    setNotice(L("已发布。小程序下次进入页面时读取新版本。", "Published. The Mini Program reads it on the next page visit."));
  });
  const restore = (source: number) => startTransition(async () => {
    const result = await restoreMiniappRuntime(source, revision.current);
    if (!result.ok) { setNotice(L("恢复失败，请重新读取后再试。", "Restore failed. Reload and retry.")); return; }
    revision.current = result.data.revision; setBench(result.data); dispatch({ type: "restore", spec: result.data.draft });
    setNotice(L(`已把第 ${source} 版恢复为草稿，确认后再发布。`, `Version ${source} restored as a draft.`));
  });
  const pendingChanges = changes(bench.live, spec, locale);
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
  const setTabHidden = (slot: RuntimeTabSpec["slot"], hidden: boolean) => setSpec(current => ({ ...current, tabs: current.tabs.map(row => row.slot === slot ? withHidden(row, hidden) : row) }));
  const setBlockHidden = (id: string, hidden: boolean) => updateScreen(blocks => updateBlock(blocks, id, row => withHidden(row, hidden)));

  return <DashboardPage title={L("小程序操作台", "Mini Program workbench")} backHref="/dashboard/miniapp-settings" backLabel={L("小程序设置", "Mini Program settings")}
    commandPanel={<DashboardCommandPanel><DashboardCommandActions>
      <span className="text-sm text-muted">{bench.publishedAt ? `${L("最近发布", "Published")} ${new Date(bench.publishedAt).toLocaleString(locale)}` : bench.fromSettings ? L("客户端正在使用小程序设置中的页面", "Clients use the settings pages") : ""}</span>
      {bench.history.length > 0 && <select aria-label={L("历史版本", "History")} className="h-9 rounded-md border border-line bg-paper px-2 text-sm" value="" disabled={pending}
        onChange={event => event.target.value && restore(Number(event.target.value))}>
        <option value="">{L("历史版本…", "History…")}</option>{bench.history.map(row => <option key={row.revision} value={row.revision}>{L(`第 ${row.revision} 版`, `Version ${row.revision}`)} · {new Date(row.publishedAt).toLocaleString(locale)}</option>)}</select>}
      <Button disabled={pending || shownState === "conflict" || shownState === "invalid"} onClick={() => setPublishOpen(true)}>{L("发布", "Publish")}</Button>
    </DashboardCommandActions></DashboardCommandPanel>}>
    {notice && <p role="status" className="mb-2 text-sm">{notice}</p>}
    <Card className="h-[calc(100dvh-9rem)] min-h-[34rem] overflow-hidden">
      <ResizablePanelGroup groupRef={groupRef} orientation="horizontal" onLayoutChanged={onLayoutChanged} className="size-full">
        <ResizablePanel id="directory" minSize={200} defaultSize={240} maxSize="40%" groupResizeBehavior="preserve-pixel-size" className="overflow-hidden">
          <nav aria-label={L("页面目录", "Pages")} className="flex size-full min-h-0 flex-col">
            <div className={cn(header, "flex items-center justify-between px-3")}><span className="text-sm font-medium">{L("页面", "Pages")}</span>
              <Button size="sm" variant="ghost" className="size-8 p-0" title={L("新建页面", "New page")} aria-label={L("新建页面", "New page")} onClick={() => addScreen()}><Plus className="size-4" /></Button></div>
            <div className="min-h-0 flex-1 overflow-y-auto py-2">
              <p className="px-3 pb-1 text-[11px] font-medium text-muted">{L("底部导航", "Tab bar")}</p>
              {runtimeTabSlots.map(slot => {
                const row = spec.tabs.find(item => item.slot === slot), target = row && spec.screens.find(item => item.id === row.screen);
                return row && target ? <div key={"tab-" + slot} className={cn("flex items-center gap-1 pl-3 hover:bg-moon/20", screen?.id === target.id && !blockId && "bg-moon/30 font-medium")}>
                  {shownBox(!!row.hidden, hidden => setTabHidden(slot, hidden), canHideTab(spec.tabs, slot) ? undefined : slot === 1 ? L("第 1 项是打开小程序时的首页，不能隐藏", "Tab 1 opens first") : L("底部导航至少显示两项", "Keep two tabs shown"))}
                  <button type="button" onClick={() => { setScreenId(target.id); setBlockId(""); }} className={cn("flex min-w-0 flex-1 items-center gap-2 py-2 pl-1 pr-3 text-left text-sm", row.hidden && "opacity-45")}>
                    <span className="min-w-0 flex-1 truncate">{`${slot} · ${row.label[locale] || row.label.zh}`}</span>
                    <span className="shrink-0 text-[11px] text-muted">{row.hidden ? L("已隐藏", "Hidden") : row.visibleWhen ? L("有条件", "Rule") : ""}</span></button></div>
                  : spec.tabs.length < 5 && <button type="button" key={"tab-" + slot} onClick={() => addScreen(slot)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-muted hover:bg-moon/20"><Plus className="size-3.5" />{L(`第 ${slot} 项：添加导航`, `Add tab ${slot}`)}</button>;
              })}
              <p className="px-3 pb-1 pt-3 text-[11px] font-medium text-muted">{L("其他页面", "Other pages")}</p>
              {spec.screens.filter(row => !tabScreens.has(row.id)).map(row => directoryRow(row.id, row.title[locale] || row.title.zh || row.id, "", screen?.id === row.id && !blockId, () => { setScreenId(row.id); setBlockId(""); }))}
              {screen && <div className="mt-3 border-t border-line pt-2">
                <p className="px-3 pb-1 text-[11px] font-medium text-muted">{L("本页组成", "On this page")} · {screen.title[locale] || screen.title.zh}</p>
                {outline(screen.blocks).map(({ block: row, depth }) => <div key={row.id} style={{ paddingLeft: 12 + depth * 14 }}
                  className={cn("flex items-center gap-1 hover:bg-moon/20", blockId === row.id && "bg-crater/15 font-medium")}>
                  {shownBox(!!row.hidden, hidden => setBlockHidden(row.id, hidden))}
                  <button type="button" onClick={() => setBlockId(row.id)} title={row.hidden ? L("已隐藏，小程序里不显示", "Hidden from the Mini Program") : preview && !shown.has(row.id) ? L("当前预览身份看不到这一项", "Hidden for this preview identity") : undefined}
                    className={cn("flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-1 pr-3 text-left text-xs", (row.hidden || (preview && !shown.has(row.id))) && "opacity-45")}>
                    <span className="shrink-0 text-muted">{blockNames[row.type][locale]}</span><span className="truncate">{blockSummary(row, locale)}</span>
                    {(row.hidden || row.visibleWhen) && <span className="ml-auto shrink-0 text-[10px] text-muted">{row.hidden ? L("已隐藏", "Hidden") : L("条件", "Rule")}</span>}</button></div>)}
              </div>}
            </div>
          </nav>
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel id="canvas" minSize={420} className="overflow-hidden">
          <div role="toolbar" aria-label={L("插入组件", "Insert")} className={cn(header, "flex items-center gap-1 px-2")}>
            <Button size="sm" variant="ghost" className="size-9 p-0" title={L("撤销 · Ctrl+Z", "Undo · Ctrl+Z")} aria-label={L("撤销", "Undo")} disabled={!past.length} onClick={undo}><Undo2 className="size-4" /></Button>
            <Button size="sm" variant="ghost" className="size-9 p-0" title={L("重做 · Ctrl+Shift+Z", "Redo")} aria-label={L("重做", "Redo")} disabled={!future.length} onClick={redo}><Redo2 className="size-4" /></Button>
            <span className="mx-1 h-5 w-px bg-line" />
            <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">{tools.map(({ type, icon: Icon }) =>
              <Button key={type} size="sm" variant="ghost" className="size-9 shrink-0 p-0" title={L(`插入${blockNames[type].zh}`, `Insert ${blockNames[type].en}`)} aria-label={blockNames[type][locale]} onClick={() => insert(type)}><Icon className="size-4" /></Button>)}</div>
            <span className={cn("shrink-0 px-2 text-xs", ["invalid", "error", "conflict"].includes(shownState) ? "text-rose" : "text-muted")}>{status[shownState]}</span>
            {saveState === "conflict" && <Button size="sm" variant="secondary" onClick={reload}>{L("重新读取", "Reload")}</Button>}
          </div>
          <div className="flex shrink-0 items-center justify-center gap-4 border-b border-line px-3 py-1.5 text-xs">
            <span className="flex items-center gap-1"><span className="text-muted">{L("预览身份", "Preview as")}</span>
              {(["visitor", "member"] as const).map(value => <button type="button" key={value} onClick={() => setMode(value)} className={cn("rounded-full px-2.5 py-0.5", mode === value ? "bg-crater/15 text-ink" : "text-muted")}>
                {value === "visitor" ? L("未登录访客", "Visitor") : L("已登录家长（示例数据）", "Signed-in family (examples)")}</button>)}</span>
            <span className="flex items-center gap-1"><span className="text-muted">{L("编辑语言", "Language")}</span>
              {(["zh", "en"] as const).map(value => <button type="button" key={value} onClick={() => setEditLocale(value)} className={cn("rounded-full px-2.5 py-0.5", editLocale === value ? "bg-crater/15 text-ink" : "text-muted")}>{value === "zh" ? "中文" : "English"}</button>)}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto bg-moon/10 p-4">
            {preview ? <RuntimePhone title={preview.screen.title} brand={preview.screen.navigation === "brand"} blocks={preview.screen.blocks} tabs={preview.tabs} activeScreen={screen?.id ?? ""}
              strings={editLocale === "zh" ? { signIn: "登录", today: "今", weekdays: "一,二,三,四,五,六,日", view: "查看", chooseParticipant: "选择参与人", signInNow: "点击登录" }
                : { signIn: "Sign in", today: "Today", weekdays: "M,T,W,T,F,S,S", view: "View", chooseParticipant: "Choose participant", signInNow: "Sign in" }}
              selected={blockId} onSelect={setBlockId} onTab={id => { setScreenId(id); setBlockId(""); }} />
              : <p className="pt-20 text-center text-sm text-muted">{L("正在生成预览…", "Rendering preview…")}</p>}
            {preview && preview.issues.length > 0 && <ul className="mx-auto mt-3 max-w-[375px] space-y-1 text-xs text-rose">{preview.issues.slice(0, 5).map(issue => <li key={issue}>{issue}</li>)}</ul>}
          </div>
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel id="inspector" minSize={280} defaultSize={330} maxSize="45%" groupResizeBehavior="preserve-pixel-size" className="overflow-hidden">
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
        </ResizablePanel>
      </ResizablePanelGroup>
    </Card>
    <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
      <DialogContent>
        <DialogHeader><DialogTitle>{L("发布到小程序", "Publish to the Mini Program")}</DialogTitle>
          <DialogDescription>{L("发布后，家长下次进入页面即看到新版本；不需要重新上传小程序。", "Families see it on their next page visit; no Mini Program upload is needed.")}</DialogDescription></DialogHeader>
        {pendingChanges.length ? <ul className="list-disc space-y-1 pl-5 text-sm">{pendingChanges.map(row => <li key={row}>{row}</li>)}</ul>
          : <p className="text-sm text-muted">{L("与当前客户端看到的内容相同。", "Same as what clients see now.")}</p>}
        <p className="text-xs text-muted">{L("本次使用的组件均在当前小程序运行时支持范围内。", "All components are supported by the current Mini Program runtime.")}</p>
        <DialogFooter><Button variant="secondary" onClick={() => setPublishOpen(false)}>{L("取消", "Cancel")}</Button><Button disabled={pending} onClick={publish}>{L("确认发布", "Publish")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </DashboardPage>;
}
