import { ApiError } from "../../lib/api";
import {
  cachedScreen, commandEffects, currentApp, findBlock, loadBlock, loadScreen, onAppChange, prepareBlocks, refreshApp, replaceBlock,
  resolveCode, runAction, runtimeContextMarker, runtimeImage, setBlockFilter, setParticipant, tabScreen, takeLaunchScene,
} from "../../lib/runtime";
import {
  runtimePageFilters, runtimeParams, runtimeParamsKey, runtimeTabRoutes, type RuntimeAction, type RuntimeBlockView, type RuntimeEffect, type RuntimeFacet,
  type RuntimeParams, type RuntimeScreen, type RuntimeTabSlot,
} from "../../lib/runtime-contract";

type Reveal = { style: string; title: string; body: string; image: string; tag: string; action: RuntimeAction | null };
type Sheet =
  | { kind: "facet"; block: string; page: boolean; facet: RuntimeFacet; groups: { group: string; options: RuntimeFacet["options"] }[] }
  | { kind: "account"; name: string }
  | { kind: "participants"; rows: { id: string; name: string }[] }
  | { kind: "screen"; id: string; params: RuntimeParams; title: string; blocks: RuntimeBlockView[]; loading: boolean; generation: number }
  | null;
function tabBar(hidden: boolean | null, slot?: number) {
  const page = getCurrentPages().slice(-1)[0] as unknown as { getTabBar?: () => WechatMiniprogram.Component.TrivialInstance | null } | undefined;
  const bar = page?.getTabBar?.();
  if (bar) bar.setData({ ...(hidden === null ? {} : { hidden }), ...(slot ? { selected: slot } : {}) });
}

const subscriptions = new WeakMap<object, () => void>();
const refreshTimers = new WeakMap<object, ReturnType<typeof setTimeout>>();
function stopRefresh(host: object) { const timer = refreshTimers.get(host); if (timer) clearTimeout(timer); refreshTimers.delete(host); }
// Hosts one published screen. Tab pages pass their slot; other pages pass the screen id from the link.
Component({
  options: { styleIsolation: "apply-shared", pureDataPattern: /^_/ },
  properties: { tab: { type: Number, value: 0 }, screenId: { type: String, value: "" }, screenParams: { type: Object, value: {} } },
  data: {
    presentation: currentApp().presentation || "classic", tone: "default", _refreshSeconds: 0, _expandedList: false,
    strings: currentApp().strings, theme: currentApp().theme, locale: currentApp().locale, title: "", navigation: "title" as "brand" | "title", pageClass: "",
    blocks: [] as RuntimeBlockView[], loading: false, error: "", missing: false, sheet: null as Sheet, reveal: null as Reveal | null, back: false, current: "",
    share: null as RuntimeScreen["share"], _participants: [] as { id: string; name: string }[],
    _screen: "", _generation: 0, _sheetGeneration: 0, _session: "", _paramsKey: "", _visible: false,
  },
  observers: { "screenId, screenParams"() { if (this.data._visible) this.show(false); } },
  lifetimes: {
    attached() {
      this.setData({ back: !this.data.tab && getCurrentPages().length > 1 });
      subscriptions.set(this, onAppChange(() => { if (this.data._visible) this.show(false); }));
    },
    detached() { stopRefresh(this); subscriptions.get(this)?.(); subscriptions.delete(this); this.setData({ _generation: this.data._generation + 1 }); },
  },
  pageLifetimes: {
    show() { this.setData({ _visible: true }); this.show(true); },
    hide() { stopRefresh(this); this.setData({ _visible: false, sheet: null, reveal: null, _generation: this.data._generation + 1, _sheetGeneration: this.data._sheetGeneration + 1 }); },
  },
  methods: {
    /** Shows the cached copy first, then reads the current publication for this account. */
    show(refreshShell: boolean) {
      stopRefresh(this);
      const app = currentApp();
      if (this.data.tab && app.revision !== "built-in" && !app.tabs.some(tab => tab.slot === this.data.tab)) {
        wx.switchTab({ url: runtimeTabRoutes[app.tabs[0].slot] }); return;
      }
      if (this.data.tab) tabBar(false, this.data.tab);
      const screen = this.data.tab ? tabScreen(this.data.tab as RuntimeTabSlot) : this.data.screenId;
      const sessionMarker = runtimeContextMarker(), paramsKey = runtimeParamsKey(this.data.screenParams);
      const changed = screen !== this.data._screen || sessionMarker !== this.data._session || paramsKey !== this.data._paramsKey;
      // The original tab pages keep their page-level background and spacing.
      const pageClass = ({ discover: "discover-page", calendar: "calendar-page", account: "account-page" } as Record<string, string>)[screen] || "";
      this.setData({ strings: app.strings, theme: app.theme, presentation: app.presentation || "classic", locale: app.locale, missing: !screen, pageClass, current: screen, _screen: screen,
        _session: sessionMarker, _paramsKey: paramsKey, ...(changed ? { blocks: [], title: "", sheet: null, reveal: null, error: "", share: null, _participants: [] } : {}) });
      if (screen) {
        const cached = cachedScreen(screen, this.data.screenParams);
        if (cached) this.apply(cached);
        else if (changed) this.setData({ blocks: [], title: "" });
        void this.load();
      }
      if (refreshShell) void refreshApp();
      // A Mini Program code opened at launch is offered to Mathin once.
      const scene = takeLaunchScene();
      if (scene) resolveCode(scene, "scene").then(effects => this.runEffects(effects, "page"), () => undefined);
    },
    apply(screen: RuntimeScreen) {
      this.setData({ tone: screen.tone || "default", _refreshSeconds: screen.refreshSeconds || 0, _expandedList: false });
      this.setData({ title: screen.title, navigation: screen.navigation, blocks: prepareBlocks(screen.blocks), error: "", share: screen.share ? { ...screen.share, image: runtimeImage(screen.share.image) } : null, _participants: screen.participants || [] });
      if (!this.data.tab) wx.setNavigationBarTitle({ title: screen.title });
      if (screen.share) wx.showShareMenu({ menus: ["shareAppMessage", "shareTimeline"] }); else wx.hideShareMenu({});
    },
    async load() {
      const id = this.data._screen, generation = this.data._generation + 1;
      if (!id) return;
      this.setData({ _generation: generation, loading: !this.data.blocks.length });
      try {
        const screen = await loadScreen(id, this.data.screenParams);
        if (generation === this.data._generation) this.apply(screen);
      } catch (error) {
        if (generation === this.data._generation) {
          if (error instanceof ApiError && error.code === "CONTEXT_CHANGED") this.show(false);
          else this.setData({ error: this.data.strings.unavailable });
        }
      } finally {
        if (generation === this.data._generation) this.setData({ loading: false });
        this.scheduleRefresh();
      }
    },
    scheduleRefresh() {
      stopRefresh(this);
      const seconds = this.data._refreshSeconds;
      if (!this.data._visible || seconds < 15 || seconds > 300 || this.data._expandedList) return;
      refreshTimers.set(this, setTimeout(() => {
        refreshTimers.delete(this);
        if (this.data._visible && !this.data.sheet && !this.data.reveal) void this.load();
        else this.scheduleRefresh();
      }, seconds * 1000));
    },
    reload() { return this.load(); },
    async refreshBlock(block: string, extra: Record<string, string> = {}) {
      const id = this.data._screen;
      try {
        const generation = this.data._generation;
        const result = await loadBlock(id, block, extra, this.data.screenParams);
        if (id !== this.data._screen || generation !== this.data._generation) return;
        this.setData({ blocks: replaceBlock(this.data.blocks, block, result.block ? prepareBlocks([result.block])[0] : null) });
      } catch { wx.showToast({ title: this.data.strings.unavailable, icon: "none" }); }
    },
    /** Runs any action: simple ones in the runtime library, sheets, child choice and commands here. */
    async handle(action: RuntimeAction | null | undefined, origin: "page" | "sheet") {
      if (!action) return;
      const kind = await runAction(action);
      if (kind === "reload") { if (origin === "sheet") void this.reloadSheet(); else void this.load(); }
      else if (kind === "sheet" && action.type === "screen") void this.openScreen(action.screen, action.params);
      else if (kind === "participant") this.openSheet({ kind: "participants", rows: this.data._participants });
      else if (kind === "command") {
        const screen = origin === "sheet" && this.data.sheet?.kind === "screen" ? this.data.sheet.id : this.data._screen;
        try {
          const params = origin === "sheet" && this.data.sheet?.kind === "screen" ? this.data.sheet.params : this.data.screenParams;
          const effects = await commandEffects(action, { screen, block: "", params });
          if (effects) this.runEffects(effects, origin);
        } catch (error) {
          if (error instanceof ApiError && error.code === "CONTEXT_CHANGED") return;
          wx.showToast({ title: error instanceof ApiError && ["NOT_FOUND", "UPDATE_REQUIRED"].includes(error.code) ? this.data.strings.updateRequired : this.data.strings.unavailable, icon: "none" });
        }
      }
    },
    /** Effects decided by Mathin, run in order. */
    async runEffects(effects: RuntimeEffect[], origin: "page" | "sheet") {
      for (const effect of effects) {
        switch (effect.type) {
          case "toast": wx.showToast({ title: effect.text, icon: effect.icon === "success" ? "success" : "none" }); break;
          case "dialog":
            wx.showModal({ title: effect.title, content: effect.body, confirmText: effect.confirm || this.data.strings.confirm, showCancel: !!effect.cancel, cancelText: effect.cancel || this.data.strings.cancel,
              success: result => { if (result.confirm && effect.action) void this.handle(effect.action, origin); } });
            break;
          case "reveal":
            this.setData({ reveal: { style: effect.style, title: effect.title, body: effect.body, image: effect.image.startsWith("asset:") ? "/assets/" + effect.image.slice(6) + ".png" : effect.image,
              tag: effect.tag || "", action: effect.action || null } });
            if (this.data.tab) tabBar(true);
            break;
          case "action": await this.handle(effect.action, origin); break;
          case "refresh":
            if (origin === "sheet") void this.reloadSheet();
            if (effect.blocks?.length) effect.blocks.forEach(id => { if (findBlock(this.data.blocks, id)) void this.refreshBlock(id); });
            else void this.load();
            break;
          case "app": await refreshApp(true); break;
          case "reset": break;
          default: wx.showToast({ title: this.data.strings.updateRequired, icon: "none" }); break;
        }
      }
    },
    action(e: WechatMiniprogram.CustomEvent<{ action: RuntimeAction }>) { void this.handle(e.detail.action, "page"); },
    sheetAction(e: WechatMiniprogram.CustomEvent<{ action: RuntimeAction }>) { void this.handle(e.detail.action, "sheet"); },
    async effects(e: WechatMiniprogram.CustomEvent<{ effects: RuntimeEffect[]; after: RuntimeAction | null }>) {
      await this.runEffects(e.detail.effects || [], "page");
      if (e.detail.after) void this.handle(e.detail.after, "page");
    },
    async sheetEffects(e: WechatMiniprogram.CustomEvent<{ effects: RuntimeEffect[]; after: RuntimeAction | null }>) {
      await this.runEffects(e.detail.effects || [], "sheet");
      if (e.detail.after) void this.handle(e.detail.after, "sheet");
    },
    async selectChild(id: string, open?: RuntimeTabSlot) {
      if (!this.data._participants.some(row => row.id === id)) return;
      setParticipant(id);
      this.setData({ blocks: [], sheet: null, reveal: null, share: null, _generation: this.data._generation + 1 });
      const marker = runtimeContextMarker(), app = await refreshApp(true);
      if (marker !== runtimeContextMarker()) return;
      const target = open && app.tabs.find(tab => tab.slot === open);
      if (target) wx.switchTab({ url: runtimeTabRoutes[target.slot] });
      else this.show(false);
    },
    participant(e: WechatMiniprogram.CustomEvent<{ id: string; open?: RuntimeTabSlot }>) {
      if (!e.detail.id) return;
      void this.selectChild(String(e.detail.id), e.detail.open);
    },
    account(e: WechatMiniprogram.CustomEvent<{ name: string }>) { this.openSheet({ kind: "account", name: e.detail.name }); },
    sheet(e: WechatMiniprogram.CustomEvent<{ kind: string; block: string }>) {
      const block = findBlock(this.data.blocks, e.detail.block);
      if (block?.type === "participants") this.openSheet({ kind: "participants", rows: block.participants.map(row => ({ id: row.id, name: row.name })) });
    },
    chooseParticipant(e: WechatMiniprogram.TouchEvent) {
      const id = String(e.currentTarget.dataset.id || "");
      this.close();
      if (id) void this.selectChild(id);
    },
    async signOut() { this.close(); await this.handle({ type: "logout" }, "page"); },
    openSheet(sheet: NonNullable<Sheet>) { this.setData({ sheet }); if (this.data.tab) tabBar(true); },
    /** Opens another published screen in a bottom sheet over this page. */
    async openScreen(id: string, params?: Record<string, string>) {
      const generation = this.data._sheetGeneration + 1, context = runtimeParams(params);
      this.setData({ _sheetGeneration: generation });
      this.openSheet({ kind: "screen", id, params: context, title: "", blocks: [], loading: true, generation });
      try {
        const screen = await loadScreen(id, context);
        if (this.data.sheet?.kind === "screen" && this.data.sheet.generation === generation)
          this.setData({ sheet: { kind: "screen", id, params: context, title: screen.title, blocks: prepareBlocks(screen.blocks), loading: false, generation } });
      } catch {
        if (this.data.sheet?.kind === "screen" && this.data.sheet.generation === generation) {
          this.close(); wx.showToast({ title: this.data.strings.unavailable, icon: "none" });
        }
      }
    },
    async reloadSheet() { const sheet = this.data.sheet; if (sheet?.kind === "screen") await this.openScreen(sheet.id, sheet.params); },
    week(e: WechatMiniprogram.CustomEvent<{ block: string; anchor: string }>) { void this.refreshBlock(e.detail.block, { anchor: e.detail.anchor }); },
    facet(e: WechatMiniprogram.CustomEvent<{ block: string; facet: string; clear?: boolean }>) {
      const block = findBlock(this.data.blocks, e.detail.block);
      if (e.detail.clear) {
        const facets = block?.type === "filters" ? block.facets.map(row => row.id) : ["stage", "topic", "q"];
        facets.forEach(id => setBlockFilter(this.data._screen, runtimePageFilters, id, "", this.data.screenParams));
        void this.load();
        return;
      }
      const page = block?.type === "filters";
      const facet = block?.type === "list" || block?.type === "filters" ? block.facets.find(row => row.id === e.detail.facet) : undefined;
      if (!facet) return;
      const groups: { group: string; options: RuntimeFacet["options"] }[] = [];
      facet.options.forEach(option => {
        const last = groups[groups.length - 1];
        if (last && last.group === option.group) last.options.push(option); else groups.push({ group: option.group, options: [option] });
      });
      this.openSheet({ kind: "facet", block: e.detail.block, page, facet, groups });
    },
    choose(e: WechatMiniprogram.TouchEvent) {
      const sheet = this.data.sheet;
      if (sheet?.kind !== "facet") return;
      setBlockFilter(this.data._screen, sheet.page ? runtimePageFilters : sheet.block, sheet.facet.id, String(e.currentTarget.dataset.value || ""), this.data.screenParams);
      this.close();
      // A page filter bar changes every list on the screen, so the whole screen is read again.
      if (sheet.page) void this.load(); else void this.refreshBlock(sheet.block);
    },
    search(e: WechatMiniprogram.CustomEvent<{ block: string; facet: string; value: string }>) {
      setBlockFilter(this.data._screen, e.detail.block, e.detail.facet, e.detail.value, this.data.screenParams);
      void this.refreshBlock(e.detail.block);
    },
    /** Appends the next page of a list. */
    async more(e: WechatMiniprogram.CustomEvent<{ block: string; cursor: string }>) {
      const id = this.data._screen;
      try {
        const generation = this.data._generation;
        const result = await loadBlock(id, e.detail.block, { cursor: e.detail.cursor }, this.data.screenParams);
        const before = findBlock(this.data.blocks, e.detail.block), next = result.block ? prepareBlocks([result.block])[0] : null;
        if (id !== this.data._screen || generation !== this.data._generation || !next || next.type !== "list" || before?.type !== "list") return;
        const seen = new Set(before.items.map(row => row.id));
        stopRefresh(this);
        this.setData({ _expandedList: true, blocks: replaceBlock(this.data.blocks, e.detail.block, { ...next, items: [...before.items, ...next.items.filter(row => !seen.has(row.id))] }) });
      } catch { wx.showToast({ title: this.data.strings.unavailable, icon: "none" }); }
    },
    refresh(e: WechatMiniprogram.CustomEvent<{ block: string }>) { if (this.data._visible) void this.refreshBlock(e.detail.block); },
    revealAction() { const action = this.data.reveal?.action; this.closeReveal(); if (action) void this.handle(action, "page"); },
    closeReveal() { this.setData({ reveal: null }); if (this.data.tab && !this.data.sheet) tabBar(false); },
    close() { this.setData({ sheet: null }); if (this.data.tab) tabBar(false); },
    retry() { void this.load(); },
    firstTab() { wx.switchTab({ url: "/pages/discover/index" }); },
    noop() {},
  },
});
