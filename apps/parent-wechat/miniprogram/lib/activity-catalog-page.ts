import { activityCatalog, miniappContentImage } from "./api";
import type { ActivityOffer } from "./api-types";
import { activityCard, activityCatalogLabels, activityFilters, activityTopics, filterActivityOffers, saveActivityFilters } from "./activity-catalog";
import { pageData, syncPage, errorText, currentLocale } from "./page";
import { configuration, configuredEntries, openConfiguredAction } from "./miniapp-configuration";
import { miniappText, type MiniappAction } from "./miniapp-settings";

function homeProjection(offers: ReturnType<typeof activityCard>[]) {
  const config = configuration(), locale = currentLocale();
  return {
    homeBlocks: config.home.filter(b => b.visible).map(b => {
      const ordered = [...offers].sort((a, other) => {
        const ai = b.featuredIds.indexOf(a.id), bi = b.featuredIds.indexOf(other.id);
        return (ai < 0 ? Infinity : ai) - (bi < 0 ? Infinity : bi);
      });
      return { ...b, label: miniappText(b.title, locale), description: miniappText(b.body, locale), imageUrl: miniappContentImage(b.image),
        offers: b.type === "activities" ? ordered.slice(0, b.limit) : [] };
    }),
    floatingEntries: configuredEntries(config.floating, locale),
  };
}

export function registerActivityCatalogPage(full: boolean) {
  Page({
    data: { ...pageData("discover"), ...activityCatalogLabels("zh"), ...homeProjection([]), full, offers: [] as ReturnType<typeof activityCard>[], stage: "", topic: "", loaded: false, sheet: "" },
    source: [] as ActivityOffer[], loadedAt: 0,
    onShow() { syncPage(this, "discover"); this.setData(activityFilters()); this.applyFilters(); if (Date.now() - this.loadedAt > 15_000) void this.load(); },
    configurationChanged() { this.setData(activityFilters()); this.applyFilters(); },
    onHide() { this.setData({ sheet: "" }); },
    async load() {
      if (this.data.loading) return;
      this.setData({ loading: true, error: "" });
      try {
        const source = await activityCatalog();
        const topic = activityTopics(source).some(item => item.id === this.data.topic) ? this.data.topic : "";
        this.source = source; this.loadedAt = Date.now();
        this.setData({ topic, loaded: true }); saveActivityFilters(this.data); this.applyFilters();
      }
      catch (error) { this.setData({ error: errorText(error) }); }
      finally { this.setData({ loading: false }); }
    },
    applyFilters() {
      const offers = filterActivityOffers(this.source, this.data.stage, this.data.topic).map(r => activityCard(r, currentLocale()));
      this.setData({ ...activityCatalogLabels(currentLocale(), this.data.stage, this.data.topic, this.source), offers: this.data.full ? offers : [], ...homeProjection(offers) });
    },
    openConfigured(e: WechatMiniprogram.TouchEvent) { openConfiguredAction(e.currentTarget.dataset.action as MiniappAction, String(e.currentTarget.dataset.target || "")); },
    showFilter(e: WechatMiniprogram.TouchEvent) { this.setData({ sheet: e.currentTarget.dataset.filter === "topic" ? "topic" : "stage" }); },
    closeSheet() { this.setData({ sheet: "" }); }, noop() {},
    chooseFilter(e: WechatMiniprogram.TouchEvent) {
      const value = String(e.currentTarget.dataset.value || "");
      this.setData(this.data.sheet === "topic" ? { topic: value, sheet: "" } : { stage: value, sheet: "" });
      saveActivityFilters(this.data); this.applyFilters();
    },
    reset() { this.setData({ stage: "", topic: "" }); saveActivityFilters(this.data); this.applyFilters(); },
    showAll() { wx.navigateTo({ url: "/pages/activity-catalog/index" }); },
    book() { wx.navigateTo({ url: "/pages/assessment/index" }); },
    service() { wx.navigateTo({ url: "/pages/service/index?stage=" + encodeURIComponent(this.data.stage) }); },
    applications() { wx.navigateTo({ url: "/pages/activity-requests/index" }); },
    openActivity(e: WechatMiniprogram.TouchEvent) { wx.navigateTo({ url: "/pages/activity-detail/index?id=" + encodeURIComponent(String(e.currentTarget.dataset.id)) }); },
  });
}
