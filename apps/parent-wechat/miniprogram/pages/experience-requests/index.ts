import { configuredPage } from "../../lib/native-page";
import { experienceRequest, session } from "../../lib/api";
import type { ExperienceRequest } from "../../lib/experience-runtime";
import { localText } from "../../lib/miniapp-experience";
import { pageData, syncPage, currentLocale, date, errorText, loginPage } from "../../lib/page";
const states = { submitted: ["待受理", "Submitted"], confirmed: ["已确认", "Confirmed"], completed: ["已完成", "Completed"], cancelled: ["已取消", "Cancelled"], declined: ["未受理", "Declined"] };
type Row = ExperienceRequest & { title: string; when: string; statusLabel: string; fields: { key: string; label: string; value: string }[] };
configuredPage("experience-requests")({
  data: { ...pageData("discover"), rows: [] as Row[], authenticated: false, expanded: "", page: 1, more: false, busy: false },
  generation: 0,
  onShow() { syncPage(this, "discover"); this.setData({ authenticated: !!session() }); if (session()) void this.load(); },
  onHide() { this.generation++; this.setData({ rows: [], expanded: "", loading: false }); },
  onUnload() { this.generation++; },
  async load() { const generation = ++this.generation; this.setData({ loading: true, error: "" });
    try { const rows = await experienceRequest<ExperienceRequest[]>("requests?page=" + this.data.page); if (generation !== this.generation) return; const locale = currentLocale();
      this.setData({ rows: rows.map(row => ({ ...row, title: localText(row.serviceName, locale), when: date(row.createdAt), statusLabel: states[row.status][locale === "en" ? 1 : 0], fields: (row.form?.groups || []).reduce((fields, group) => {
        (row.answers[group.id] || []).forEach((answers, i) => group.fields.forEach(field => { const answer = answers[field.id]; if (answer === undefined) return;
          fields.push({ key: group.id + "." + i + "." + field.id, label: localText(field.label, locale), value: (Array.isArray(answer) ? answer : [answer]).map(v => field.type === "consent" ? (locale === "en" ? "Confirmed" : "已确认") : localText(field.options.find(o => o.id === v)?.label, locale) || v).join(" · ") }); })); return fields;
      }, [] as Row["fields"]) })), more: rows.length === 30 });
    } catch (error) { if (generation === this.generation) this.setData({ error: errorText(error) }); } finally { if (generation === this.generation) this.setData({ loading: false }); }
  },
  toggle(e: WechatMiniprogram.TouchEvent) { const id = String(e.currentTarget.dataset.id); this.setData({ expanded: this.data.expanded === id ? "" : id }); },
  async cancel(e: WechatMiniprogram.TouchEvent) { if (this.data.busy) return; const row = this.data.rows.find(r => r.id === e.currentTarget.dataset.id); if (!row) return;
    const generation = this.generation, answer = await wx.showModal({ title: currentLocale() === "en" ? "Cancel this request?" : "取消这项申请？", content: row.title }); if (!answer.confirm || generation !== this.generation) return; this.setData({ busy: true });
    try { await experienceRequest("requests", { action: "cancel", id: row.id, version: row.version }); if (generation === this.generation) await this.load(); } catch (error) { if (generation === this.generation) this.setData({ error: errorText(error) }); } finally { this.setData({ busy: false }); }
  },
  next() { this.setData({ page: this.data.page + 1 }); void this.load(); }, previous() { if (this.data.page > 1) { this.setData({ page: this.data.page - 1 }); void this.load(); } },
  login() { loginPage("/pages/experience-requests/index"); },
});
