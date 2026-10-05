import { courseApplications, courseCommand, session } from "../../lib/api";
import type { CourseApplication } from "../../lib/api-types";
import { courseCopy, coursePrice, courseDate } from "../../lib/course-catalog";
import { pageData, syncPage, currentLocale, errorText, loginPage } from "../../lib/page";

Page({
  data: { ...pageData("account"), t: courseCopy.zh, authenticated: false, source: [] as CourseApplication[],
    rows: [] as (CourseApplication & { price: string; dateLabel: string; statusLabel: string })[], filter: "", busy: false,
    statuses: [] as { id: string; label: string }[] },
  version: 0,
  onShow() { syncPage(this, "account"); const t = courseCopy[currentLocale()]; this.setData({ t, authenticated: Boolean(session()), statuses: (["pending", "confirmed", "declined", "cancelled"] as const).map(id => ({ id, label: t[id] })) }); void this.load(); },
  onHide() { this.version++; },
  async load() {
    if (this.data.busy) return;
    const version = ++this.version; this.setData({ error: "", loading: true, rows: [], source: [] });
    if (!session()) { this.setData({ loading: false }); return; }
    try { const source = await courseApplications(); if (version === this.version) { this.setData({ source }); this.render(); } }
    catch (error) { if (version === this.version) this.setData({ error: errorText(error), authenticated: Boolean(session()) }); }
    finally { if (version === this.version) this.setData({ loading: false }); }
  },
  render() { this.setData({ rows: this.data.source.filter(a => !this.data.filter || a.status === this.data.filter).map(a => ({ ...a, price: coursePrice(a.priceCents, currentLocale()), dateLabel: courseDate(a.createdAt), statusLabel: this.data.t[a.status] })) }); },
  filter(e: WechatMiniprogram.TouchEvent) { const id = String(e.currentTarget.dataset.id); this.setData({ filter: this.data.filter === id ? "" : id }); this.render(); },
  login() { loginPage("/pages/course-applications/index"); },
  async cancel(e: WechatMiniprogram.TouchEvent) {
    if (this.data.busy) return;
    const id = String(e.currentTarget.dataset.id); if (!this.data.source.some(a => a.id === id && a.status === "pending")) return;
    const confirm = await wx.showModal({ title: this.data.t.cancelPrompt }); if (!confirm.confirm) return;
    this.setData({ busy: true, error: "" });
    try { await courseCommand({ action: "cancel", id }); this.setData({ busy: false }); await this.load(); }
    catch (error) { this.setData({ error: errorText(error) }); }
    finally { this.setData({ busy: false }); }
  },
});
