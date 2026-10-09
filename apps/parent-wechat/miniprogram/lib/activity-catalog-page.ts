import { activityCatalog } from "./api";
import type { ActivityOffer } from "./api-types";
import { activityCard, activityCatalogLabels, activityFilters, filterActivityOffers, saveActivityFilters } from "./activity-catalog";
import { pageData, syncPage, errorText, currentLocale } from "./page";
import { registrationReplayAvailable, registrationReplayCopy } from "./registration-replay";

export function registerActivityCatalogPage(full: boolean) {
  Page({
    data: { ...pageData("discover"), ...activityCatalogLabels("zh"), full, source: [] as ActivityOffer[], offers: [] as ReturnType<typeof activityCard>[], stage: "", topic: "", loaded: false, sheet: "", registrationReplay: false, replayCopy: registrationReplayCopy.zh },
    onShow() { syncPage(this, "discover"); this.setData({ ...activityFilters(), registrationReplay: !full && registrationReplayAvailable(), replayCopy: registrationReplayCopy[currentLocale()] }); this.applyFilters(); void this.load(); },
    onHide() { this.setData({ sheet: "" }); },
    async load() {
      if (this.data.loading) return;
      this.setData({ loading: true, error: "" });
      try { const source = await activityCatalog(); this.setData({ source, loaded: true }); this.applyFilters(); }
      catch (error) { this.setData({ error: errorText(error) }); }
      finally { this.setData({ loading: false }); }
    },
    applyFilters() { this.setData({ ...activityCatalogLabels(currentLocale(), this.data.stage, this.data.topic), offers: filterActivityOffers(this.data.source, this.data.stage, this.data.topic).map(r => activityCard(r, currentLocale())) }); },
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
    replayRegistration() { if (registrationReplayAvailable()) wx.navigateTo({ url: "/pages/onboarding/index?replay=1" }); },
    openActivity(e: WechatMiniprogram.TouchEvent) { wx.navigateTo({ url: "/pages/activity-detail/index?id=" + encodeURIComponent(String(e.currentTarget.dataset.id)) }); },
  });
}
