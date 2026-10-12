import { ApiError, get, activityDetail, activityRequests, activityCommand, requestId, session } from "../../lib/api";
import type { Account, Participant, ActivityOffer, ActivityRequestCommand } from "../../lib/api-types";
import { activityCopy, activityRegistrationNote } from "../../lib/activity-catalog";
import { pageData, syncPage, currentLocale, errorText, loginPage, date } from "../../lib/page";
import { selectedParticipant, selectParticipant } from "../../lib/navigation";
import { restoreActivityRequest } from "../../lib/cache-compat";

type ApplyCommand = Extract<ActivityRequestCommand, { action: "apply" }>;
const pendingKey = (account: string, offer: string) => `gezhi.activity-application.v1.${account}.${offer}`;
Page({
  data: { ...pageData("discover"), t: activityCopy.zh, id: "", authenticated: false, accountId: "", offer: null as ActivityOffer | null,
    participants: [] as Participant[], selected: 0, busy: false, pending: null as ApplyCommand | null, sent: false, activityWhen: "",
    signup: { instructions: "", confirmation: "", success: "" }, registrationNote: "" },
  version: 0, visible: false,
  onLoad(query: Record<string, string>) { this.setData({ id: query.id || "" }); },
  onShow() { this.visible = true; syncPage(this, "discover"); this.setData({ t: activityCopy[currentLocale()], authenticated: Boolean(session()) }); if (!this.data.busy) void this.load(); },
  onHide() { this.visible = false; this.version++; },
  async load() {
    const version = ++this.version;
    this.setData({ loading: true, error: "", accountId: "", participants: [], offer: null, pending: null, sent: false });
    if (!session()) { this.setData({ loading: false }); return; }
    try {
      const [account, detail, applications] = await Promise.all([get<Account>("account"), activityDetail(this.data.id).catch(error => {
        if (error instanceof ApiError && error.code === "NOT_FOUND") return null;
        throw error;
      }), activityRequests()]);
      if (version !== this.version) return;
      const offer = detail?.offer || null;
      const pending = restoreActivityRequest(wx.getStorageSync(pendingKey(account.id, this.data.id)), this.data.id);
      const sent = Boolean(pending && applications.some(a => a.id === pending.id));
      if (sent) wx.removeStorageSync(pendingKey(account.id, this.data.id));
      this.setData({ accountId: account.id, offer, participants: account.participants,
        signup: detail?.page?.signup || { instructions: "", confirmation: "", success: "" }, registrationNote: offer ? activityRegistrationNote(offer, currentLocale()) : this.data.t.submitNote,
        selected: Math.max(0, account.participants.findIndex(p => p.id === (pending && !sent ? pending.participantId : selectedParticipant()))),
        activityWhen: offer?.activity ? date(offer.activity.startsAt) : "", pending: sent ? null : pending, sent,
        error: pending && !sent ? this.data.t.unknown : !offer && !sent ? this.data.t.closed : "" });
    } catch (error) { if (version === this.version) this.setData({ error: errorText(error), authenticated: Boolean(session()) }); }
    finally { if (version === this.version) this.setData({ loading: false }); }
  },
  participant(e: WechatMiniprogram.PickerChange) {
    if (this.data.busy || this.data.pending) return;
    const selected = Number(e.detail.value), row = this.data.participants[selected];
    if (row) { selectParticipant(row.id); this.setData({ selected }); }
  },
  login() { loginPage("/pages/activity-signup/index?id=" + encodeURIComponent(this.data.id)); },
  applications() { wx.navigateTo({ url: "/pages/activity-requests/index" }); },
  async submit() {
    if (this.data.busy || this.data.loading || !this.data.authenticated || !this.data.accountId) return;
    const version = this.version, accountId = this.data.accountId, offerId = this.data.id;
    const offer = this.data.offer, participant = this.data.participants[this.data.selected];
    let command = this.data.pending;
    const key = pendingKey(accountId, offerId);
    this.setData({ busy: true, error: "" });
    try {
      if (!command) {
        if (!offer || offer.kind !== "activity" || !participant) { this.setData({ error: this.data.t.chooseHint }); return; }
        if (offer.registration?.canApply === false) { this.setData({ error: this.data.t.closed }); return; }
        const approval = await wx.showModal({ title: this.data.t.applicationPrompt, content: [this.data.signup.confirmation, this.data.registrationNote].filter(Boolean).join("\n\n") });
        if (!approval.confirm || version !== this.version || accountId !== this.data.accountId || !session()) return;
        command = { action: "apply", kind: "activity", id: requestId(), publicationId: offerId, revision: offer.revision, participantId: participant.id };
      }
      wx.setStorageSync(key, command); this.setData({ pending: command });
      const result = await activityCommand(command);
      if (result.id !== command.id) throw new Error("Unexpected application");
      wx.removeStorageSync(key);
      if (version === this.version) this.setData({ pending: null, sent: true });
    } catch (error) {
      const unknown = !(error instanceof ApiError) || ["NETWORK", "UNAVAILABLE", "UNAUTHENTICATED"].includes(error.code);
      if (!unknown) wx.removeStorageSync(key);
      if (version === this.version) this.setData({ pending: unknown ? command : null, error: unknown ? this.data.t.unknown : errorText(error) });
    } finally { this.setData({ busy: false }); if (this.visible && version !== this.version) void this.load(); }
  },
});
