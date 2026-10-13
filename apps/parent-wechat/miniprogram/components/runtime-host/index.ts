import { session } from "../../lib/api";
import {
  cachedScreen, currentApp, findBlock, loadBlock, loadScreen, onAppChange, prepareBlocks, refreshApp, replaceBlock,
  runAction, setBlockFilter, setParticipant, tabScreen,
} from "../../lib/runtime";
import { runtimePageFilters, runtimeTabRoutes, type RuntimeBlockView, type RuntimeFacet, type RuntimeScreen, type RuntimeTabSlot } from "../../lib/runtime-contract";

type Sheet =
  | { kind: "facet"; block: string; page: boolean; facet: RuntimeFacet; groups: { group: string; options: RuntimeFacet["options"] }[] }
  | { kind: "account"; name: string }
  | { kind: "participants"; rows: { id: string; name: string }[] }
  | null;
function tabBar(hidden: boolean | null, slot?: number) {
  const page = getCurrentPages().slice(-1)[0] as unknown as { getTabBar?: () => WechatMiniprogram.Component.TrivialInstance | null } | undefined;
  const bar = page?.getTabBar?.();
  if (bar) bar.setData({ ...(hidden === null ? {} : { hidden }), ...(slot ? { selected: slot } : {}) });
}

const subscriptions = new WeakMap<object, () => void>();
// Hosts one published screen. Tab pages pass their slot; other pages pass the screen id from the link.
Component({
  options: { styleIsolation: "apply-shared", pureDataPattern: /^_/ },
  properties: { tab: { type: Number, value: 0 }, screenId: { type: String, value: "" } },
  data: {
    strings: currentApp().strings, theme: currentApp().theme, locale: currentApp().locale, title: "", navigation: "title" as "brand" | "title", pageClass: "",
    blocks: [] as RuntimeBlockView[], loading: false, error: "", missing: false, sheet: null as Sheet, back: false,
    _screen: "", _generation: 0, _session: "", _visible: false,
  },
  lifetimes: {
    attached() {
      this.setData({ back: !this.data.tab && getCurrentPages().length > 1 });
      subscriptions.set(this, onAppChange(() => { if (this.data._visible) this.show(false); }));
    },
    detached() { subscriptions.get(this)?.(); subscriptions.delete(this); this.setData({ _generation: this.data._generation + 1 }); },
  },
  pageLifetimes: {
    show() { this.setData({ _visible: true }); this.show(true); },
    hide() { this.setData({ _visible: false, sheet: null }); },
  },
  methods: {
    /** Shows the cached copy first, then reads the current publication for this account. */
    show(refreshShell: boolean) {
      const app = currentApp();
      if (this.data.tab) tabBar(false, this.data.tab);
      const screen = this.data.tab ? tabScreen(this.data.tab as RuntimeTabSlot) : this.data.screenId;
      const sessionMarker = session()?.refreshToken || "";
      const changed = screen !== this.data._screen || sessionMarker !== this.data._session;
      // The original tab pages keep their page-level background and spacing.
      const pageClass = ({ discover: "discover-page", calendar: "calendar-page", account: "account-page" } as Record<string, string>)[screen] || "";
      this.setData({ strings: app.strings, theme: app.theme, locale: app.locale, missing: !screen, pageClass, _screen: screen, _session: sessionMarker });
      if (screen) {
        const cached = cachedScreen(screen);
        if (cached) this.apply(cached);
        else if (changed) this.setData({ blocks: [], title: "" });
        void this.load();
      }
      if (refreshShell) void refreshApp();
    },
    apply(screen: RuntimeScreen) {
      this.setData({ title: screen.title, navigation: screen.navigation, blocks: prepareBlocks(screen.blocks), error: "" });
      if (!this.data.tab) wx.setNavigationBarTitle({ title: screen.title });
    },
    async load() {
      const id = this.data._screen, generation = this.data._generation + 1;
      if (!id) return;
      this.setData({ _generation: generation, loading: !this.data.blocks.length });
      try {
        const screen = await loadScreen(id);
        if (generation === this.data._generation) this.apply(screen);
      } catch {
        if (generation === this.data._generation) this.setData({ error: this.data.strings.unavailable });
      } finally {
        if (generation === this.data._generation) this.setData({ loading: false });
      }
    },
    reload() { return this.load(); },
    async refreshBlock(block: string, extra: Record<string, string> = {}) {
      const id = this.data._screen;
      try {
        const result = await loadBlock(id, block, extra);
        if (id !== this.data._screen) return;
        this.setData({ blocks: replaceBlock(this.data.blocks, block, result.block ? prepareBlocks([result.block])[0] : null) });
      } catch { wx.showToast({ title: this.data.strings.unavailable, icon: "none" }); }
    },
    async action(e: WechatMiniprogram.CustomEvent<{ action: Parameters<typeof runAction>[0] }>) {
      if (await runAction(e.detail.action) === "reload") void this.load();
    },
    participant(e: WechatMiniprogram.CustomEvent<{ id: string; open?: RuntimeTabSlot }>) {
      if (!e.detail.id) return;
      setParticipant(String(e.detail.id));
      if (e.detail.open && runtimeTabRoutes[e.detail.open]) wx.switchTab({ url: runtimeTabRoutes[e.detail.open] }); else void this.load();
    },
    account(e: WechatMiniprogram.CustomEvent<{ name: string }>) { this.openSheet({ kind: "account", name: e.detail.name }); },
    sheet(e: WechatMiniprogram.CustomEvent<{ kind: string; block: string }>) {
      const block = findBlock(this.data.blocks, e.detail.block);
      if (block?.type === "participants") this.openSheet({ kind: "participants", rows: block.participants.map(row => ({ id: row.id, name: row.name })) });
    },
    chooseParticipant(e: WechatMiniprogram.TouchEvent) {
      const id = String(e.currentTarget.dataset.id || "");
      this.close();
      if (id) { setParticipant(id); wx.switchTab({ url: runtimeTabRoutes[2] }); }
    },
    async signOut() { this.close(); if (await runAction({ type: "logout" }) === "reload") void this.load(); },
    openSheet(sheet: NonNullable<Sheet>) { this.setData({ sheet }); if (this.data.tab) tabBar(true); },
    week(e: WechatMiniprogram.CustomEvent<{ block: string; anchor: string }>) { void this.refreshBlock(e.detail.block, { anchor: e.detail.anchor }); },
    facet(e: WechatMiniprogram.CustomEvent<{ block: string; facet: string; clear?: boolean }>) {
      const block = findBlock(this.data.blocks, e.detail.block);
      if (e.detail.clear) {
        ["stage", "topic"].forEach(id => setBlockFilter(this.data._screen, runtimePageFilters, id, ""));
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
      setBlockFilter(this.data._screen, sheet.page ? runtimePageFilters : sheet.block, sheet.facet.id, String(e.currentTarget.dataset.value || ""));
      this.close();
      // A page filter bar changes every list on the screen, so the whole screen is read again.
      if (sheet.page) void this.load(); else void this.refreshBlock(sheet.block);
    },
    close() { this.setData({ sheet: null }); if (this.data.tab) tabBar(false); },
    retry() { void this.load(); },
    firstTab() { wx.switchTab({ url: "/pages/discover/index" }); },
    noop() {},
  },
});
