import { configuration, refreshConfiguration, openConfiguredAction } from "../../lib/miniapp-configuration";
import { miniappContentImage } from "../../lib/api";
import { localText } from "../../lib/miniapp-experience";
import { pageData, syncPage, currentLocale } from "../../lib/page";
Page({
  data: { ...pageData("discover"), category: "", services: [] as { id: string; name: string; summary: string; image: string; price: string }[], categories: [] as { id: string; label: string }[] },
  onLoad(q: Record<string, string>) { this.setData({ category: q.category || "" }); },
  onShow() { syncPage(this, "discover"); this.render(); void refreshConfiguration().then(() => this.render()); },
  configurationChanged() { this.render(); },
  render() { const experience = configuration().experience, locale = currentLocale(); this.setData({
    categories: (experience?.dictionaries.find(d => d.id === "service-categories")?.entries || []).filter(e => e.enabled).map(e => ({ id: e.id, label: localText(e.label, locale) })),
    services: (experience?.services || []).filter(s => s.enabled && (!this.data.category || s.categoryId === this.data.category)).map(s => ({ id: s.id, name: localText(s.name, locale), summary: localText(s.summary, locale), image: miniappContentImage(s.image, true), price: s.price.mode === "free" ? (locale === "en" ? "Free" : "免费") : `${s.price.currency} ${(s.price.amountMinor / 100).toFixed(2)}` })),
  }); },
  category(e: WechatMiniprogram.TouchEvent) { this.setData({ category: String(e.currentTarget.dataset.id || "") }); this.render(); },
  open(e: WechatMiniprogram.TouchEvent) { openConfiguredAction("offering", String(e.currentTarget.dataset.id)); },
  requests() { wx.navigateTo({ url: "/pages/experience-requests/index" }); },
  bookings() { wx.navigateTo({ url: "/pages/provider-bookings/index" }); },
  notifications() { wx.navigateTo({ url: "/pages/experience-notifications/index" }); },
});
