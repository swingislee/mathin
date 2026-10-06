import { ApiError, get, courseCatalog, courseApplications, courseCommand, requestId, session } from "../../lib/api";
import type { Account, Participant, CourseOffer, CourseApplicationCommand } from "../../lib/api-types";
import { courseCopy } from "../../lib/course-catalog";
import { pageData, syncPage, currentLocale, errorText, loginPage, date } from "../../lib/page";
import { selectedParticipant, selectParticipant } from "../../lib/navigation";

type ApplyCommand = Extract<CourseApplicationCommand, { action: "apply" }>;
const pendingKey = (account: string, offer: string) => `gezhi.activity-application.v1.${account}.${offer}`;
Page({
  data: { ...pageData("discover"), t: courseCopy.zh, id: "", authenticated: false, accountId: "", offer: null as CourseOffer | null,
    participants: [] as Participant[], selected: 0, busy: false, pending: null as ApplyCommand | null, sent: false, activityWhen: "" },
  version: 0, visible: false,
  onLoad(query: Record<string, string>) { this.setData({ id: query.id || "" }); },
  onShow() { this.visible = true; syncPage(this, "discover"); this.setData({ t: courseCopy[currentLocale()], authenticated: Boolean(session()) }); if (!this.data.busy) void this.load(); },
  onHide() { this.visible = false; this.version++; },
  async load() {
    const version = ++this.version;
    this.setData({ loading: true, error: "", accountId: "", participants: [], offer: null, pending: null, sent: false });
    if (!session()) { this.setData({ loading: false }); return; }
    try {
      const [account, offers, applications] = await Promise.all([get<Account>("account"), courseCatalog(), courseApplications()]);
      if (version !== this.version) return;
      const offer = offers.find(o => o.id === this.data.id && o.kind === "activity") || null;
      const stored = wx.getStorageSync(pendingKey(account.id, this.data.id)) as ApplyCommand | null;
      const pending = stored?.action === "apply" && stored.kind === "activity" && stored.classroomId === null && stored.publicationId === this.data.id ? stored : null;
      const sent = Boolean(pending && applications.some(a => a.id === pending.id));
      if (sent) wx.removeStorageSync(pendingKey(account.id, this.data.id));
      this.setData({ accountId: account.id, offer, participants: account.participants,
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
  login() { loginPage("/pages/course-select/index?id=" + encodeURIComponent(this.data.id)); },
  applications() { wx.navigateTo({ url: "/pages/course-applications/index" }); },
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
        const approval = await wx.showModal({ title: this.data.t.applicationPrompt, content: this.data.t.submitNote });
        if (!approval.confirm || version !== this.version || accountId !== this.data.accountId || !session()) return;
        command = { action: "apply", kind: "activity", id: requestId(), publicationId: offerId, revision: offer.revision, classroomId: null, participantId: participant.id };
      }
      wx.setStorageSync(key, command); this.setData({ pending: command });
      const result = await courseCommand(command);
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
