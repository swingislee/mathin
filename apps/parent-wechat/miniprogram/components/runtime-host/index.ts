import { session } from "../../lib/api";
import {
  cachedScreen, currentApp, findBlock, loadBlock, loadScreen, onAppChange, prepareBlocks, refreshApp, replaceBlock,
  runAction, setBlockFilter, setParticipant, tabScreen,
} from "../../lib/runtime";
import type { RuntimeBlockView, RuntimeFacet, RuntimeScreen, RuntimeTabSlot } from "../../lib/runtime-contract";

type Sheet = { block: string; facet: RuntimeFacet; groups: { group: string; options: RuntimeFacet["options"] }[] } | null;
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
    strings: currentApp().strings, theme: currentApp().theme, locale: currentApp().locale, title: "", navigation: "title" as "brand" | "title",
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
      this.setData({ strings: app.strings, theme: app.theme, locale: app.locale, missing: !screen, _screen: screen, _session: sessionMarker });
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
    participant(e: WechatMiniprogram.CustomEvent<{ id: string }>) { setParticipant(String(e.detail.id)); void this.load(); },
    week(e: WechatMiniprogram.CustomEvent<{ block: string; anchor: string }>) { void this.refreshBlock(e.detail.block, { anchor: e.detail.anchor }); },
    facet(e: WechatMiniprogram.CustomEvent<{ block: string; facet: string }>) {
      const block = findBlock(this.data.blocks, e.detail.block);
      const facet = block?.type === "list" ? block.facets.find(row => row.id === e.detail.facet) : undefined;
      if (!facet) return;
      const groups: NonNullable<Sheet>["groups"] = [];
      facet.options.forEach(option => {
        const last = groups[groups.length - 1];
        if (last && last.group === option.group) last.options.push(option); else groups.push({ group: option.group, options: [option] });
      });
      this.setData({ sheet: { block: e.detail.block, facet, groups } });
      if (this.data.tab) tabBar(true);
    },
    choose(e: WechatMiniprogram.TouchEvent) {
      const sheet = this.data.sheet;
      if (!sheet) return;
      setBlockFilter(this.data._screen, sheet.block, sheet.facet.id, String(e.currentTarget.dataset.value || ""));
      this.close();
      void this.refreshBlock(sheet.block);
    },
    close() { this.setData({ sheet: null }); if (this.data.tab) tabBar(false); },
    retry() { void this.load(); },
    firstTab() { wx.switchTab({ url: "/pages/discover/index" }); },
    noop() {},
  },
});
