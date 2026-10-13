import { configuredPage } from "../../lib/native-page";
import { configuration, refreshConfiguration, openConfiguredAction } from "../../lib/miniapp-configuration";
import { serviceCard } from "../../lib/service-card";
import { miniappContentImage } from "../../lib/api";
import { localText } from "../../lib/miniapp-experience";
import { pageData, syncPage, currentLocale } from "../../lib/page";
configuredPage("service-catalog")({
  data: { ...pageData("discover"), category: "", services: [] as ReturnType<typeof serviceCard>[], categories: [] as { id: string; label: string }[] },
  onLoad(q: Record<string, string>) { this.setData({ category: q.category || "" }); },
  onShow() { syncPage(this, "discover"); this.render(); void refreshConfiguration().then(() => this.render()); },
  configurationChanged() { this.render(); },
  render() { const experience = configuration().experience, locale = currentLocale(); this.setData({
    categories: [{ id: "", label: locale === "en" ? "All" : "全部" }, ...(experience?.dictionaries.find(d => d.id === "service-categories")?.entries || []).filter(e => e.enabled).map(e => ({ id: e.id, label: localText(e.label, locale) }))],
    services: (experience?.services || []).filter(s => s.enabled && (!this.data.category || s.categoryId === this.data.category)).map(s => serviceCard(s, locale, miniappContentImage(s.image, true))),
  }); },
  category(e: WechatMiniprogram.CustomEvent<{ value: string }>) { this.setData({ category: String(e.detail.value || "") }); this.render(); },
  open(e: WechatMiniprogram.CustomEvent<{ id: string }>) { openConfiguredAction("offering", String(e.detail.id)); },
  requests() { wx.navigateTo({ url: "/pages/experience-requests/index" }); },
  bookings() { wx.navigateTo({ url: "/pages/provider-bookings/index" }); },
  notifications() { wx.navigateTo({ url: "/pages/experience-notifications/index" }); },
});
