import { configuredPage } from "../../lib/native-page";
import { activityRequests, activityCommand, activityRegistrationAnswers, session } from "../../lib/api";
import type { ActivityRequest } from "../../lib/api-types";
import { activityCopy, activityPrice, activityDate } from "../../lib/activity-catalog";
import { pageData, syncPage, currentLocale, errorText, loginPage } from "../../lib/page";
import { questionAnswerText, type FormAnswerSnapshot } from "../../lib/form-questions";

function rowView(row: ActivityRequest) {
  return { id: row.id, title: row.title, participantName: row.participantName, reply: row.reply, status: row.status,
    hasAnswers: !!row.hasAnswers, canCancel: row.canCancel ?? row.status === "pending", price: activityPrice(row.priceCents, currentLocale()),
    dateLabel: activityDate(row.createdAt), statusLabel: activityCopy[currentLocale()][row.status], expanded: false,
    answers: [] as { label: string; value: string }[] };
}

configuredPage("activity-requests")({
  data: { ...pageData("account"), t: activityCopy.zh, authenticated: false,
    rows: [] as ReturnType<typeof rowView>[], filter: "", busy: false, answersBusy: "",
    statuses: [] as { id: string; label: string }[] },
  version: 0,
  source: [] as ActivityRequest[], answers: {} as Record<string, FormAnswerSnapshot>,
  onShow() { syncPage(this, "account"); const t = activityCopy[currentLocale()]; this.setData({ t, authenticated: Boolean(session()), statuses: (["pending", "contacted", "confirmed", "declined", "cancelled"] as const).map(id => ({ id, label: t[id] })) }); void this.load(); },
  onHide() { this.version++; },
  async load() {
    if (this.data.busy) return;
    const version = ++this.version; this.source = []; this.answers = {}; this.setData({ error: "", loading: true, rows: [] });
    if (!session()) { this.setData({ loading: false }); return; }
    try { const source = await activityRequests(); if (version === this.version) { this.source = source; this.render(); } }
    catch (error) { if (version === this.version) this.setData({ error: errorText(error), authenticated: Boolean(session()) }); }
    finally { if (version === this.version) this.setData({ loading: false }); }
  },
  render() { this.setData({ rows: this.source.filter(a => !this.data.filter || a.status === this.data.filter).map(rowView) }); },
  async showAnswers(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id), version = this.version;
    const row = this.data.rows.find(r => r.id === id);
    if (!row?.hasAnswers || this.data.answersBusy) return;
    this.setData({ answersBusy: id, error: "" });
    try {
      const snapshot = this.answers[id] || await activityRegistrationAnswers(id);
      if (version !== this.version) return;
      this.answers[id] = snapshot;
      const index = this.data.rows.findIndex(r => r.id === id), locale = currentLocale();
      if (index >= 0) this.setData({ [`rows[${index}].expanded`]: !row.expanded, [`rows[${index}].answers`]: snapshot.fields.map(f => ({ label: f.label[locale] || f.label.zh, value: questionAnswerText(f, snapshot.answers[f.id], locale) || (locale === "zh" ? "未填写" : "Not provided") })) });
    } catch (error) { if (version === this.version) this.setData({ error: errorText(error) }); }
    finally { this.setData({ answersBusy: "" }); }
  },
  filter(e: WechatMiniprogram.CustomEvent<{ value: string }>) { const id = String(e.detail.value); this.setData({ filter: this.data.filter === id ? "" : id }); this.render(); },
  login() { loginPage("/pages/activity-requests/index"); },
  async cancel(e: WechatMiniprogram.TouchEvent) {
    if (this.data.busy) return;
    const id = String(e.currentTarget.dataset.id); if (!this.source.some(a => a.id === id && (a.canCancel ?? a.status === "pending"))) return;
    const confirm = await wx.showModal({ title: this.data.t.cancelPrompt }); if (!confirm.confirm) return;
    this.setData({ busy: true, error: "" });
    try { await activityCommand({ action: "cancel", id }); this.setData({ busy: false }); await this.load(); }
    catch (error) { this.setData({ error: errorText(error) }); }
    finally { this.setData({ busy: false }); }
  },
});
