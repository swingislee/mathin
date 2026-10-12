import { ApiError, beginGuardianBinding, cancelPendingAuthentication, confirmGuardianBinding, get, guardianBindingPhone, guardianBindingPreview } from "../../lib/api";
import type { Account, GuardianBindingPreview, GuardianBindingStep, GuardianConfirmation } from "../../lib/api-types";
import { currentLocale, date, errorText, pageData, syncPage } from "../../lib/page";
import { guardianCopy, guardianInvitation } from "../../lib/guardian-binding";
import { clearNavigation, selectParticipant } from "../../lib/navigation";

Page({
  data: { ...pageData("account"), words: guardianCopy.zh, code: "", invitation: null as GuardianBindingPreview | null,
    stage: "entry", expires: "", busy: false, ticket: "", policy: null as Extract<GuardianBindingStep, { state: "confirmation_required" }> | null,
    parentName: "", relation: 0, consent: false, childName: "" },
  active: true,
  onShow() {
    syncPage(this, "account");
    wx.setNavigationBarTitle({ title: this.data.words.title });
  },
  onLoad(query: Record<string, string | undefined>) {
    this.active = true;
    const locale = currentLocale(), words = guardianCopy[locale];
    this.setData({ locale, words, code: guardianInvitation(query.scene || query.code) });
    wx.setNavigationBarTitle({ title: words.title });
    // A scan reads only the redacted invitation. WeChat and phone authorization require taps below.
    if (this.data.code) void this.preview();
  },
  onUnload() { this.active = false; cancelPendingAuthentication(); this.setData({ busy: false, ticket: "", policy: null }); },
  input(event: WechatMiniprogram.Input) { this.setData({ code: event.detail.value.trim(), invitation: null, stage: "entry", ticket: "", policy: null, consent: false }); },
  name(event: WechatMiniprogram.Input) { this.setData({ parentName: event.detail.value }); },
  relation(event: WechatMiniprogram.PickerChange) { this.setData({ relation: Number(event.detail.value) }); },
  consent(event: WechatMiniprogram.CheckboxGroupChange) { this.setData({ consent: event.detail.value.includes("consent") }); },
  browse() {
    if (this.data.busy && this.data.stage === "confirm") return;
    this.onUnload(); clearNavigation(); wx.switchTab({ url: "/pages/discover/index" });
  },
  account() { clearNavigation(); wx.switchTab({ url: "/pages/account/index" }); },
  scan() {
    if (this.data.busy) return;
    wx.scanCode({ onlyFromCamera: false, success: result => {
      const source = result.path || result.result || "";
      const code = guardianInvitation(source.match(/[?&](?:scene|code)=([^&]*)/)?.[1] || source);
      if (!this.active) return;
      this.setData({ code, invitation: null, stage: "entry", ticket: "", policy: null, consent: false });
      if (code) void this.preview(); else this.setData({ error: this.data.words.invalid });
    } });
  },
  async preview() {
    if (!this.active || this.data.busy) return;
    const code = guardianInvitation(this.data.code);
    if (!code) { this.setData({ error: this.data.words.invalid }); return; }
    this.setData({ busy: true, error: "", ticket: "", policy: null, consent: false });
    try {
      const invitation = await guardianBindingPreview(code);
      if (this.active) this.setData({ code, invitation, expires: date(invitation.expiresAt), stage: "preview" });
    } catch (error) { if (this.active) this.setData({ error: this.explain(error) }); }
    finally { if (this.active) this.setData({ busy: false }); }
  },
  step(value: GuardianBindingStep) {
    if (!this.active) return;
    this.setData({ ticket: value.ticket, stage: value.state === "phone_required" ? "phone" : "confirm",
      policy: value.state === "confirmation_required" ? value : null, consent: false });
  },
  async start() {
    if (!this.active || this.data.busy || !this.data.invitation) return;
    this.setData({ busy: true, error: "", ticket: "", policy: null, consent: false });
    try { this.step(await beginGuardianBinding(this.data.code)); }
    catch (error) { if (this.active) this.setData({ error: this.explain(error), stage: "preview" }); }
    finally { if (this.active) this.setData({ busy: false }); }
  },
  async phone(event: WechatMiniprogram.CustomEvent<{ code?: string }>) {
    if (!this.active || this.data.busy || !this.data.ticket) return;
    if (!event.detail.code) { this.browse(); return; }
    this.setData({ busy: true, error: "" });
    try { this.step(await guardianBindingPhone(this.data.ticket, event.detail.code)); }
    catch (error) { if (this.active) this.setData({ error: this.explain(error), stage: "preview", ticket: "" }); }
    finally { if (this.active) this.setData({ busy: false }); }
  },
  async confirm() {
    const policy = this.data.policy;
    if (this.data.busy || !policy || !this.data.consent || !this.data.parentName.trim() || !this.data.relation) return;
    const relation = ["mother", "father", "guardian"][this.data.relation - 1] as GuardianConfirmation["relation"];
    this.setData({ busy: true, error: "" });
    try {
      const result = await confirmGuardianBinding(this.data.ticket, { parentName: this.data.parentName.trim(), relation,
        consent: true, privacyVersion: policy.privacyVersion, childrenPrivacyVersion: policy.childrenPrivacyVersion });
      if (!this.active) return;
      if (result.participantId) selectParticipant(result.participantId);
      this.setData({ stage: "done", ticket: "", policy: null });
      const account = await get<Account>("account");
      if (this.active) this.setData({ childName: account.participants.find(row => row.id === result.participantId)?.name || "" });
    } catch (error) {
      if (this.active) this.setData({ error: this.explain(error),
        ...(error instanceof ApiError && ["UNAUTHENTICATED", "FORM_CHANGED"].includes(error.code) ? { stage: "preview", ticket: "", policy: null } : {}) });
    } finally { if (this.active) this.setData({ busy: false }); }
  },
  policy(event: WechatMiniprogram.TouchEvent) {
    const kind = event.currentTarget.dataset.kind === "children" ? "children" : "privacy";
    const content = this.data.policy?.policyText[currentLocale()][kind];
    if (content) wx.showModal({ title: this.data.words[kind], content, showCancel: false });
  },
  explain(error: unknown) {
    if (error instanceof ApiError) {
      if (error.code === "NOT_FOUND") return this.data.words.unavailable;
      if (error.code === "ACCOUNT_SECURITY") return this.data.words.security;
      if (error.code === "CONFLICT") return this.data.words.conflict;
      if (error.code === "UNAUTHENTICATED") return this.data.words.expired;
    }
    return errorText(error);
  },
});
