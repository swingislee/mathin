import { ApiError, authorizeWechatPhone, completeWechatFamily, loginWithWechat, session } from "../../lib/api";
import { pageData, currentLocale, errorText } from "../../lib/page";
import { clearNavigation, selectParticipant } from "../../lib/navigation";
import { onboardingCopy, saveOnboardingPreferences, takeOnboardingProof, type FamilyRegistration, type PhoneResult, type RegistrationLocation } from "../../lib/onboarding";

Page({
  data: { ...pageData("account"), words: onboardingCopy.zh, stage: "wechat", busy: false, ticket: "", scene: "", maskedPhone: "",
    parentName: "", childName: "", school: "", relationIndex: 0, genderIndex: 0, gradeIndex: 0,
    gradeLabels: [] as string[], interests: [] as string[], selectedInterests: {} as Record<string, boolean>, consent: false, location: { status: "unavailable" } as RegistrationLocation,
    locationAttempted: false, locating: false, policy: null as PhoneResult | null },
  active: true,
  onLoad(query: Record<string,string | undefined>) {
    this.active = true;
    const locale = currentLocale();
    this.setData({ locale, words: onboardingCopy[locale], gradeLabels: locale === "zh"
      ? ["选择孩子年级", "幼中班", "幼大班", "一年级", "二年级", "三年级", "四年级", "五年级", "六年级", "初一", "初二", "初三", "高一", "高二", "高三"]
      : ["Choose grade", "K2", "K3", ...Array.from({ length: 12 }, (_, index) => `Grade ${index + 1}`)] });
    const proof = takeOnboardingProof();
    let scene = "";
    try { const value = decodeURIComponent(query.scene || proof?.scene || ""); if (/^[a-f0-9]{24}$/.test(value)) scene = value; } catch { /* Invalid attribution is not carried forward. */ }
    this.setData({ scene });
    if (proof) this.setData({ ticket: proof.ticket, stage: "phone" });
    else if (session() && !scene) this.discover();
    else void this.start();
  },
  onUnload() { this.active = false; this.setData({ ticket: "", policy: null }); },
  discover() { clearNavigation(); wx.switchTab({ url: "/pages/discover/index" }); },
  async start() {
    if (this.data.busy) return;
    this.setData({ busy: true, error: "", stage: "wechat", ticket: "" });
    try {
      const result = await loginWithWechat(this.data.scene || undefined);
      if (!this.active) return;
      if (result.state === "authenticated") this.discover();
      else if (result.state === "onboarding_required") this.setData({ stage: "phone", ticket: result.ticket });
      else this.setData({ error: this.data.words.binding });
    } catch (error) { if (this.active) this.setData({ error: this.authError(error) }); }
    finally { if (this.active) this.setData({ busy: false }); }
  },
  async phone(event: WechatMiniprogram.CustomEvent<{ code?: string; errMsg?: string }>) {
    if (this.data.busy || !this.data.ticket) return;
    if (!event.detail.code) { this.setData({ error: this.data.words.denied }); return; }
    this.setData({ busy: true, error: "" });
    try {
      const policy = await authorizeWechatPhone(this.data.ticket, event.detail.code);
      if (this.active) this.setData({ stage: "family", ticket: policy.ticket, maskedPhone: policy.maskedPhone, policy });
    } catch (error) { if (this.active) this.setData({ stage: "wechat", ticket: "", error: this.authError(error) }); }
    finally { if (this.active) this.setData({ busy: false }); }
  },
  input(event: WechatMiniprogram.Input) {
    const key = String(event.currentTarget.dataset.field);
    if (["parentName", "childName", "school"].includes(key)) this.setData({ [key]: event.detail.value });
  },
  picker(event: WechatMiniprogram.PickerChange) {
    const key = String(event.currentTarget.dataset.field);
    if (["relationIndex", "genderIndex", "gradeIndex"].includes(key)) this.setData({ [key]: Number(event.detail.value) });
  },
  chooseInterests(event: WechatMiniprogram.CheckboxGroupChange) { this.setData({ interests: event.detail.value,
    selectedInterests: { math: event.detail.value.includes("math"), science: event.detail.value.includes("science"), activities: event.detail.value.includes("activities") } }); },
  consent(event: WechatMiniprogram.CheckboxGroupChange) { this.setData({ consent: event.detail.value.includes("yes") }); },
  async locate() {
    if (this.data.locating) return;
    this.setData({ locating: true });
    try {
      if (typeof wx.requirePrivacyAuthorize === "function") await wx.requirePrivacyAuthorize({});
      const value = await wx.getLocation({ type: "gcj02" });
      if (this.active) this.setData({ location: { status: "granted", latitude: value.latitude, longitude: value.longitude,
        accuracy: Number.isFinite(value.accuracy) ? value.accuracy : null }, locationAttempted: true });
    } catch (error) {
      const message = typeof error === "object" && error !== null && "errMsg" in error ? String(error.errMsg) : "";
      if (this.active) this.setData({ location: { status: /deny|denied|cancel|authorize/.test(message) ? "declined" : "unavailable" }, locationAttempted: true });
    } finally { if (this.active) this.setData({ locating: false }); }
  },
  skipLocation() { this.setData({ location: { status: "declined" }, locationAttempted: true }); },
  policy(event: WechatMiniprogram.TouchEvent) {
    const key = event.currentTarget.dataset.kind === "children" ? "children" : "privacy";
    const policy = this.data.policy?.policyText[currentLocale()];
    if (policy) wx.showModal({ title: key === "privacy" ? this.data.words.privacy : this.data.words.childrenPrivacy, content: policy[key], showCancel: false });
  },
  privacy() { wx.openPrivacyContract({ fail: () => this.setData({ error: this.data.words.unavailable }) }); },
  authError(error: unknown) {
    if (error instanceof ApiError) {
      if (error.code === "UNAUTHENTICATED") return this.data.words.expired;
      if (error.code === "ACCOUNT_SECURITY" || error.code === "CONFLICT") return this.data.words.existing;
      if (error.code === "UNAVAILABLE") return this.data.words.unavailable;
    }
    return errorText(error);
  },
  async complete() {
    const data = this.data;
    if (data.busy || !data.policy) return;
    if (!data.parentName.trim() || !data.childName.trim() || data.gradeIndex === 0 || !data.interests.length || !data.consent) {
      this.setData({ error: data.words.invalid }); return;
    }
    if (!data.locationAttempted) await this.locate();
    if (!this.active) return;
    this.setData({ busy: true, error: "" });
    try {
      const family: FamilyRegistration = { parentName: data.parentName.trim(), childName: data.childName.trim(), school: data.school.trim(),
        relation: (["mother", "father", "guardian"] as const)[data.relationIndex], gender: (["", "female", "male"] as const)[data.genderIndex],
        grade: data.gradeIndex - 2, interests: data.interests as FamilyRegistration["interests"], location: this.data.location, consent: true,
        privacyVersion: data.policy.privacyVersion, childrenPrivacyVersion: data.policy.childrenPrivacyVersion };
      const result = await completeWechatFamily(data.ticket, family);
      if (!this.active) return;
      saveOnboardingPreferences(result.grade); clearNavigation(); selectParticipant(result.participantId);
      this.setData({ ticket: "", policy: null }); wx.switchTab({ url: "/pages/discover/index" });
    } catch (error) {
      if (this.active) this.setData({ error: this.authError(error), ...(error instanceof ApiError && ["UNAUTHENTICATED", "FORM_CHANGED"].includes(error.code) ? { stage: "wechat", ticket: "" } : {}) });
    } finally { if (this.active) this.setData({ busy: false }); }
  },
});
