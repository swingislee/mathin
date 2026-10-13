import { configuredPage } from "../../lib/native-page";
import { ApiError, experienceRead, experienceRequest, get, miniappDocument, requestId, session } from "../../lib/api";
import type { Account, Participant } from "../../lib/api-types";
import type { ExperienceRemoteBooking, ExperienceServiceDetail, ExperienceSlot } from "../../lib/experience-runtime";
import { cleanExperienceAnswers, experienceAnswerErrors, localText, type BookingFlow, type ExperienceAnswers, type ExperienceService, type SchedulingPolicy } from "../../lib/miniapp-experience";
import { pageData, syncPage, currentLocale, date, errorText, loginPage } from "../../lib/page";
import { openExperienceAction } from "../../lib/experience-actions";
type Create = { action: "create" | "waitlist"; id: string; serviceId: string; revision: number; slotId: string; startsAt: string | null; participantIds: string[]; answers: ExperienceAnswers; consents: Record<string, string> };
type Reschedule = { action: "reschedule"; id: string; bookingId: string; slotId: string; startsAt: string };
type Detail = { booking: ExperienceRemoteBooking; service: ExperienceService; policy: SchedulingPolicy | null; flow: BookingFlow; retryCommand: Create | null };
const storageKey = (account: string, target: string) => "gezhi.provider.pending.v1:" + account + ":" + target;
configuredPage("provider-booking")({
  data: { ...pageData("discover"), serviceId: "", bookingId: "", accountId: "", authenticated: false, detail: null as ExperienceServiceDetail | null, historical: null as Detail | null,
    title: "", resumeId: "", chosenDate: "", requiresSlot: true, slots: [] as (ExperienceSlot & { label: string; selected: boolean })[], slotId: "", selectedIds: [] as string[], participants: [] as Participant[],
    answers: {} as ExperienceAnswers, errors: [] as string[], consentDocuments: [] as { id: string; title: string; body: string; version: string; checked: boolean }[],
    pending: null as Create | Reschedule | null, sent: null as ExperienceRemoteBooking | null, busy: false, slotsLoading: false },
  generation: 0, availabilityGeneration: 0, active: false,
  onLoad(q: Record<string, string>) { this.setData({ serviceId: q.service || "", bookingId: q.booking || "", resumeId: q.resume || "", chosenDate: new Date().toISOString().slice(0, 10) }); },
  onShow() { this.active = true; syncPage(this, "discover"); this.setData({ authenticated: !!session() }); if (!this.data.busy && session()) void this.load(); },
  onHide() { this.active = false; this.generation++; this.availabilityGeneration++; this.setData({ detail: null, historical: null, participants: [], answers: {}, consentDocuments: [], pending: null, sent: null, loading: false, slotsLoading: false }); },
  onUnload() { this.active = false; this.generation++; this.availabilityGeneration++; },
  async load() { const generation = ++this.generation; this.setData({ loading: true, error: "", accountId: "", slotId: "", selectedIds: [], sent: null });
    try { const account = await get<Account>("account"); if (generation !== this.generation) return; const key = storageKey(account.id, this.data.bookingId || this.data.serviceId), pending = wx.getStorageSync(key) as Create | Reschedule | null;
      this.setData({ accountId: account.id, participants: account.participants, pending: pending?.id ? pending : null });
      if (this.data.bookingId || this.data.resumeId) { const historical = await experienceRequest<Detail>("booking-detail?id=" + encodeURIComponent(this.data.resumeId || this.data.bookingId)); if (generation !== this.generation) return;
        this.setData({ historical, serviceId: historical.service.id, title: localText(historical.service.name, currentLocale()), requiresSlot: !this.data.resumeId,
          ...(this.data.resumeId ? { pending: historical.retryCommand, sent: historical.retryCommand ? null : historical.booking } : {}) });
      } else { const detail = await experienceRead<ExperienceServiceDetail>("service", this.data.serviceId); if (generation !== this.generation) return;
        if (!detail.ready) throw new ApiError("UNAVAILABLE"); const answers: ExperienceAnswers = {}; detail.form?.groups.forEach(g => { answers[g.id] = Array.from({ length: g.minEntries }, () => ({})); });
        const consentDocuments = await Promise.all((detail.flow?.consentDocumentIds || []).map(async id => { const d = await miniappDocument(id); return { id, title: localText(d.title, currentLocale()), body: localText(d.body, currentLocale()), version: d.version, checked: false }; }));
        if (generation !== this.generation) return; this.setData({ detail, title: localText(detail.document.name, currentLocale()), answers, consentDocuments, requiresSlot: detail.flow?.mode === "appointment" });
      }
      if (this.data.requiresSlot && !this.data.pending) await this.loadSlots();
    } catch (error) { if (generation === this.generation) this.setData({ error: errorText(error) }); } finally { if (generation === this.generation) this.setData({ loading: false }); }
  },
  async loadSlots() { const generation = ++this.availabilityGeneration, from = new Date(this.data.chosenDate + "T00:00:00").toISOString(), to = new Date(Date.parse(from) + 86400000).toISOString();
    this.setData({ slotsLoading: true, slots: [], slotId: "" });
    try { const result = await experienceRequest<{ slots: ExperienceSlot[] }>("provider", { action: "availability", serviceId: this.data.serviceId, ...(this.data.bookingId ? { bookingId: this.data.bookingId } : {}), from, to }); if (generation !== this.availabilityGeneration) return;
      this.setData({ slots: result.slots.map(s => ({ ...s, label: date(s.startsAt) + " – " + date(s.endsAt).slice(-5) + (s.remaining === 0 ? (currentLocale() === "en" ? " · Waiting list" : " · 可候补") : ""), selected: false })) });
    } catch (error) { if (generation === this.availabilityGeneration) this.setData({ error: errorText(error) }); } finally { if (generation === this.availabilityGeneration) this.setData({ slotsLoading: false }); }
  },
  day(e: WechatMiniprogram.PickerChange) { if (this.data.busy || this.data.pending) return; this.setData({ chosenDate: String(e.detail.value) }); void this.loadSlots(); },
  slot(e: WechatMiniprogram.CustomEvent<{ id: string }>) { if (this.data.busy || this.data.pending) return; const id = String(e.detail.id); if (!this.data.slots.some(slot => slot.id === id)) return; this.setData({ slotId: id, slots: this.data.slots.map(s => ({ ...s, selected: s.id === id })) }); },
  answers(e: WechatMiniprogram.CustomEvent<{ answers: ExperienceAnswers }>) { if (!this.data.busy && !this.data.pending) this.setData({ answers: e.detail.answers, errors: [] }); },
  participants(e: WechatMiniprogram.CheckboxGroupChange) { if (!this.data.busy && !this.data.pending) this.setData({ selectedIds: e.detail.value }); },
  consent(e: WechatMiniprogram.CheckboxGroupChange) { if (this.data.busy || this.data.pending) return; this.setData({ consentDocuments: this.data.consentDocuments.map(d => d.id === e.currentTarget.dataset.id ? { ...d, checked: e.detail.value.includes("yes") } : d) }); },
  async submit() { if (this.data.busy || this.data.loading || this.data.slotsLoading || !this.data.accountId || !session()) return;
    const generation = this.generation, en = currentLocale() === "en", selected = this.data.slots.find(s => s.id === this.data.slotId); let command = this.data.pending;
    if (!command) {
      if (this.data.requiresSlot && !selected) { this.setData({ error: en ? "Choose a time." : "请选择时间。" }); return; }
      if (this.data.bookingId) command = { action: "reschedule", id: requestId(), bookingId: this.data.bookingId, slotId: selected!.id, startsAt: selected!.startsAt };
      else { const detail = this.data.detail; if (!detail) return; const answers = detail.form ? cleanExperienceAnswers(detail.form, this.data.answers) : {}, errors = detail.form ? experienceAnswerErrors(detail.form, answers) : [];
        this.setData({ errors }); if (errors.length || detail.flow?.requireParticipant && !this.data.selectedIds.length || !detail.flow?.allowMultipleParticipants && this.data.selectedIds.length > 1 || this.data.consentDocuments.some(d => !d.checked)) { this.setData({ error: en ? "Complete the form, participants and confirmations." : "请补齐表单、参与人和必需确认。" }); return; }
        command = { action: selected?.remaining === 0 ? "waitlist" : "create", id: requestId(), serviceId: this.data.serviceId, revision: detail.revision, slotId: selected?.id || "", startsAt: selected?.startsAt || null, participantIds: this.data.selectedIds, answers,
          consents: this.data.consentDocuments.reduce((all, d) => ({ ...all, [d.id]: d.version }), {} as Record<string, string>) };
      }
    }
    const key = storageKey(this.data.accountId, this.data.bookingId || this.data.serviceId); this.setData({ busy: true, error: "", pending: command });
    try { wx.setStorageSync(key, command); const sent = await experienceRequest<ExperienceRemoteBooking>("provider", command); wx.removeStorageSync(key); if (generation === this.generation) this.setData({ sent, pending: null }); }
    catch (error) { const uncertain = !(error instanceof ApiError) || ["NETWORK", "UNAVAILABLE", "UNAUTHENTICATED"].includes(error.code); if (!uncertain) wx.removeStorageSync(key);
      if (generation === this.generation) this.setData({ pending: uncertain ? command : null, error: uncertain ? (en ? "The result is uncertain. Retry this same request." : "结果尚未确认，请重试同一请求。") : errorText(error) });
    } finally { this.setData({ busy: false }); if (this.active && generation !== this.generation) void this.load(); }
  },
  login() { loginPage("/pages/provider-booking/index?" + (this.data.resumeId ? "resume=" + this.data.resumeId : this.data.bookingId ? "booking=" + this.data.bookingId : "service=" + this.data.serviceId)); },
  bookings() { wx.navigateTo({ url: "/pages/provider-bookings/index" }); },
  complete() { openExperienceAction(this.data.sent?.completionAction); },
});
