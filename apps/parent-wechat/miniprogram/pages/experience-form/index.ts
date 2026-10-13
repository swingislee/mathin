import { configuredPage } from "../../lib/native-page";
import { ApiError, experienceRead, experienceRequest, get, miniappDocument, requestId, session } from "../../lib/api";
import type { Account, Participant } from "../../lib/api-types";
import type { ExperiencePublication, ExperienceRequest, ExperienceServiceDetail } from "../../lib/experience-runtime";
import { cleanExperienceAnswers, experienceAnswerErrors, localText, type ExperienceAnswers, type ExperienceForm } from "../../lib/miniapp-experience";
import { pageData, syncPage, currentLocale, errorText, loginPage } from "../../lib/page";
import { openExperienceAction } from "../../lib/experience-actions";
type Command = { action: "submit"; id: string; serviceId: string; formId: string; revision: number; answers: ExperienceAnswers; participantIds: string[]; consents: Record<string, string> };
const pendingKey = (account: string, target: string) => "gezhi.experience.pending.v1:" + account + ":" + target;
configuredPage("experience-form")({
  data: { ...pageData("discover"), id: "", serviceId: "", accountId: "", authenticated: false, form: null as ExperienceForm | null, detail: null as ExperienceServiceDetail | null,
    revision: 0, title: "", introduction: "", submitLabel: "", answers: {} as ExperienceAnswers, errors: [] as string[], busy: false, pending: null as Command | null, sent: null as ExperienceRequest | null,
    participants: [] as Participant[], selectedIds: [] as string[], consents: [] as { id: string; title: string; body: string; version: string; accepted: boolean }[] },
  generation: 0, active: false,
  onLoad(q: Record<string, string>) { this.setData({ id: q.id || "", serviceId: q.service || "" }); },
  onShow() { this.active = true; syncPage(this, "discover"); this.setData({ authenticated: !!session() }); if (!this.data.busy) void this.load(); },
  onHide() { this.active = false; this.generation++; this.setData({ form: null, detail: null, answers: {}, participants: [], consents: [], sent: null, pending: null, loading: false }); },
  onUnload() { this.active = false; this.generation++; },
  async load() { const generation = ++this.generation; this.setData({ loading: true, error: "", accountId: "", sent: null }); if (!session()) { this.setData({ loading: false }); return; }
    try { const account = await get<Account>("account"); if (generation !== this.generation) return;
      const key = pendingKey(account.id, this.data.serviceId || this.data.id), pending = wx.getStorageSync(key) as Command | null;
      this.setData({ accountId: account.id, participants: account.participants, pending: pending?.action === "submit" ? pending : null });
      if (pending?.id) { const requests = await experienceRequest<ExperienceRequest[]>("requests"); if (generation !== this.generation) return; const sent = requests.find(r => r.id === pending.id);
        if (sent) { wx.removeStorageSync(key); this.setData({ sent, pending: null, title: localText(sent.serviceName, currentLocale()) }); return; } }
      const detail = this.data.serviceId ? await experienceRead<ExperienceServiceDetail>("service", this.data.serviceId) : null;
      const publication = detail ? { document: detail.form, revision: detail.revision } : await experienceRead<ExperiencePublication<ExperienceForm>>("form", this.data.id);
      if (generation !== this.generation) return; const form = publication.document; if (!form) throw new ApiError("NOT_FOUND");
      const consents = await Promise.all((detail?.flow?.consentDocumentIds || []).map(async id => { const doc = await miniappDocument(id); return { id, title: localText(doc.title, currentLocale()), body: localText(doc.body, currentLocale()), version: doc.version, accepted: false }; }));
      if (generation !== this.generation) return;
      const answers: ExperienceAnswers = {}; form.groups.forEach(g => { answers[g.id] = Array.from({ length: g.minEntries }, () => ({})); });
      this.setData({ form, detail, revision: publication.revision, title: localText(form.title, currentLocale()), introduction: localText(form.introduction, currentLocale()), submitLabel: localText(form.submitLabel, currentLocale()),
        answers: pending?.answers || answers, selectedIds: pending?.participantIds || [], consents, error: pending ? (currentLocale() === "en" ? "A submission needs confirmation. Retry with the same request." : "上次提交结果待确认，请使用下方按钮重试。") : "" });
    } catch (error) { if (generation === this.generation) this.setData({ error: errorText(error) }); }
    finally { if (generation === this.generation) this.setData({ loading: false }); }
  },
  login() { loginPage("/pages/experience-form/index?" + (this.data.serviceId ? "service=" + encodeURIComponent(this.data.serviceId) : "id=" + encodeURIComponent(this.data.id))); },
  change(e: WechatMiniprogram.CustomEvent<{ answers: ExperienceAnswers }>) { if (!this.data.busy && !this.data.pending) this.setData({ answers: e.detail.answers, errors: [] }); },
  participant(e: WechatMiniprogram.CheckboxGroupChange) { if (!this.data.busy && !this.data.pending) this.setData({ selectedIds: e.detail.value }); },
  consent(e: WechatMiniprogram.CheckboxGroupChange) { if (this.data.busy || this.data.pending) return; const id = String(e.currentTarget.dataset.id); this.setData({ consents: this.data.consents.map(d => d.id === id ? { ...d, accepted: e.detail.value.includes("yes") } : d) }); },
  async submit() { if (this.data.busy || this.data.loading || !session() || !this.data.accountId) return; const generation = this.generation, en = currentLocale() === "en";
    let command = this.data.pending; const form = this.data.form, flow = this.data.detail?.flow;
    if (!command) { if (!form) return; const answers = cleanExperienceAnswers(form, this.data.answers), errors = experienceAnswerErrors(form, answers); this.setData({ errors });
      if (errors.length) { this.setData({ error: en ? "Please complete the highlighted answers." : "请补齐标记的问题。" }); return; }
      if (flow?.requireParticipant && !this.data.selectedIds.length || !flow?.allowMultipleParticipants && this.data.selectedIds.length > 1 || this.data.consents.some(c => !c.accepted)) { this.setData({ error: en ? "Check the participants and confirmations." : "请核对参与人选择和必需确认。" }); return; }
      command = { action: "submit", id: requestId(), serviceId: this.data.serviceId, formId: form.id, revision: this.data.revision, answers, participantIds: this.data.selectedIds,
        consents: this.data.consents.reduce((result, c) => ({ ...result, [c.id]: c.version }), {} as Record<string, string>) };
    }
    const key = pendingKey(this.data.accountId, this.data.serviceId || this.data.id); this.setData({ busy: true, pending: command, error: "" });
    try { wx.setStorageSync(key, command); const sent = await experienceRequest<ExperienceRequest>("requests", command); if (sent.id !== command.id) throw new ApiError("UNAVAILABLE"); wx.removeStorageSync(key);
      if (generation === this.generation) this.setData({ sent, pending: null, answers: {} });
    } catch (error) { const unknown = !(error instanceof ApiError) || ["NETWORK", "UNAVAILABLE", "UNAUTHENTICATED"].includes(error.code);
      if (!unknown) wx.removeStorageSync(key); if (generation === this.generation) this.setData({ pending: unknown ? command : null, error: unknown ? (en ? "The result is uncertain. Retry to confirm this submission." : "暂未确认提交结果，请重试确认；不会重复生成申请。") : errorText(error) });
    } finally { this.setData({ busy: false }); if (this.active && generation !== this.generation) void this.load(); }
  },
  requests() { wx.navigateTo({ url: "/pages/experience-requests/index" }); },
  complete() { openExperienceAction(this.data.sent?.completionAction); },
});
