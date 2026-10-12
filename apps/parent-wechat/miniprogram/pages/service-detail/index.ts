import { experienceRead, session } from "../../lib/api";
import type { ExperienceServiceDetail } from "../../lib/experience-runtime";
import { localText } from "../../lib/miniapp-experience";
import { openConfiguredAction } from "../../lib/miniapp-configuration";
import { pageData, syncPage, currentLocale, errorText, loginPage } from "../../lib/page";
Page({
  data: { ...pageData("discover"), id: "", detail: null as ExperienceServiceDetail | null, title: "", summary: "", price: "", resourceRows: [] as { id: string; name: string; detail: string }[], message: "" },
  generation: 0,
  onLoad(q: Record<string, string>) { this.setData({ id: q.id || "" }); },
  onShow() { syncPage(this, "discover"); void this.load(); },
  onHide() { this.generation++; this.setData({ detail: null, loading: false }); },
  onUnload() { this.generation++; },
  async load() { const generation = ++this.generation; this.setData({ loading: true, error: "" });
    try { const detail = await experienceRead<ExperienceServiceDetail>("service", this.data.id); if (generation !== this.generation) return;
      const locale = currentLocale(), s = detail.document; this.setData({ detail, title: localText(s.name, locale), summary: localText(s.summary, locale), message: localText(detail.unavailableMessage, locale),
        price: s.price.mode === "free" ? (locale === "en" ? "Free" : "免费") : `${s.price.currency} ${(s.price.amountMinor / 100).toFixed(2)} ${localText(s.price.note, locale)}`,
        resourceRows: detail.resources.map(r => ({ id: r.id, name: localText(r.name, locale), detail: localText(r.address, locale) || localText(r.description, locale) })) });
    } catch (error) { if (generation === this.generation) this.setData({ error: errorText(error) }); }
    finally { if (generation === this.generation) this.setData({ loading: false }); }
  },
  book() { const d = this.data.detail; if (!d?.ready) return; const s = d.document;
    if (s.binding.adapter === "web") { openConfiguredAction("web", s.binding.target); return; }
    if (!session()) { loginPage("/pages/service-detail/index?id=" + encodeURIComponent(s.id)); return; }
    if (s.binding.adapter === "mathin-assessment") { openConfiguredAction("assessment"); return; }
    if (s.binding.adapter === "mathin-activity") { wx.navigateTo({ url: "/pages/activity-detail/index?id=" + encodeURIComponent(s.binding.target) }); return; }
    if (s.binding.adapter === "remote") { wx.navigateTo({ url: "/pages/provider-booking/index?service=" + encodeURIComponent(s.id) }); return; }
    wx.navigateTo({ url: "/pages/experience-form/index?service=" + encodeURIComponent(s.id) });
  },
});
