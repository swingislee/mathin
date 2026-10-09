import { ApiError, authorizeWechatPhone, completeWechatFamily, loginWithWechat, session } from "../../lib/api";
import { pageData, currentLocale, errorText } from "../../lib/page";
import { clearNavigation, selectParticipant } from "../../lib/navigation";
import { onboardingCopy, promotionScene, saveOnboardingPreferences, takeOnboardingProof, type FamilyRegistration, type PhoneResult, type RegistrationLocation } from "../../lib/onboarding";
import { DEFAULT_FAMILY_FORM, familyAnswerErrors, type FamilyAnswers, type FamilyField, type FamilyForm } from "../../lib/onboarding-form";
import { registrationLocation } from "../../lib/registration-location";
import { registrationReplayAvailable, registrationReplayCopy } from "../../lib/registration-replay";
import { participantWording } from "../../lib/participant-wording";

type DisplayField = FamilyField & { text: string; kind: "text" | "picker" | "interests"; choices: { id: string; text: string }[] };
Page({
  data: { ...pageData("account"), words: onboardingCopy.zh, stage: "wechat", busy: false, ticket: "", scene: "", maskedPhone: "",
    values: { parentName: "", childName: "", school: "" }, selection: { relation: 0, gender: 0, grade: 0 },
    choices: {} as Record<string, string[]>, fields: [] as DisplayField[], formTitle: "", formDescription: "",
    interests: [] as string[], selectedInterests: {} as Record<string, boolean>, consent: false,
    policy: null as PhoneResult | null, replay: false, replayWords: registrationReplayCopy.zh, replayResult: "", replayCapturedAt: "" },
  active: true,
  replayForm: null as FamilyForm | null,
  submissionLocation: null as Promise<RegistrationLocation> | null,
  onLoad(query: Record<string,string | undefined>) {
    this.active = true;
    this.submissionLocation = null;
    const locale = currentLocale(), words = onboardingCopy[locale];
    wx.setNavigationBarTitle({ title: words.navigationTitle });
    this.setData({ locale, words, replayWords: registrationReplayCopy[locale], choices: {
      relation: [locale === "zh" ? "请选择" : "Choose", ...words.relations], gender: words.genders,
      grade: locale === "zh" ? [words.chooseGrade, "幼中班", "幼大班", "一年级", "二年级", "三年级", "四年级", "五年级", "六年级", "初一", "初二", "初三", "高一", "高二", "高三"]
        : [words.chooseGrade, "K2", "K3", ...Array.from({ length: 12 }, (_, index) => `Grade ${index + 1}`)],
    } });
    if (query.replay === "1" && registrationReplayAvailable()) { this.restartReplay(); return; }
    const proof = takeOnboardingProof();
    const scene = promotionScene(query.scene || proof?.scene);
    this.setData({ scene });
    if (proof) this.setData({ ticket: proof.ticket, stage: "phone" });
    else if (session() && !scene) this.discover();
    else void this.start();
  },
  onUnload() { this.active = false; this.submissionLocation = null; this.replayForm = null; this.setData({ ticket: "", policy: null }); },
  discover() { if (!this.data.replay) clearNavigation(); wx.switchTab({ url: "/pages/discover/index" }); },
  restartReplay() {
    if (!this.active || this.data.busy || !registrationReplayAvailable()) return;
    this.replayForm = { ...DEFAULT_FAMILY_FORM, slug: "family-onboarding", version: 1 };
    this.submissionLocation = null;
    this.setData({ replay: true, stage: "family", ticket: "", policy: null, maskedPhone: "", error: "", consent: false,
      values: { parentName: "", childName: "", school: "" }, selection: { relation: 0, gender: 0, grade: 0 },
      interests: [], selectedInterests: {}, replayResult: "", replayCapturedAt: "" });
    this.configureForm(this.replayForm);
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
  },
  replaySettings() {
    if (this.data.replay && !this.data.busy && registrationReplayAvailable()) {
      wx.openSetting({ fail: () => this.setData({ error: this.data.words.unavailable }) });
    }
  },
  async start() {
    if (this.data.busy || this.data.replay) return;
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
  configureForm(form: FamilyForm) {
    const locale = currentLocale();
    const text = (value: { zh: string; en: string }) => participantWording(value[locale] || value.zh);
    const fields: DisplayField[] = form.fields.filter(field => field.mode !== "hidden").map(field => ({ ...field,
      text: text(field.label), kind: field.id === "interests" ? "interests" : ["relation", "gender", "grade"].includes(field.id) ? "picker" : "text",
      choices: (field.options || []).map(option => ({ id: option.id, text: text(option.label) })),
    }));
    const options = fields.find(field => field.id === "interests")?.choices || [];
    const interests = this.data.interests.filter(id => options.some(option => option.id === id));
    const selectedInterests: Record<string, boolean> = {};
    interests.forEach(id => { selectedInterests[id] = true; });
    this.setData({ fields, formTitle: text(form.title), formDescription: text(form.description), interests, selectedInterests });
  },
  async phone(event: WechatMiniprogram.CustomEvent<{ code?: string; errMsg?: string }>) {
    if (this.data.busy || this.data.replay || !this.data.ticket) return;
    if (!event.detail.code) { this.setData({ error: this.data.words.denied }); return; }
    this.setData({ busy: true, error: "" });
    try {
      const policy = await authorizeWechatPhone(this.data.ticket, event.detail.code);
      if (this.active) {
        this.configureForm(policy.form);
        this.setData({ stage: "family", ticket: policy.ticket, maskedPhone: policy.maskedPhone, policy });
      }
    } catch (error) { if (this.active) this.setData({ stage: "wechat", ticket: "", error: this.authError(error) }); }
    finally { if (this.active) this.setData({ busy: false }); }
  },
  input(event: WechatMiniprogram.Input) {
    const key = String(event.currentTarget.dataset.field);
    if (["parentName", "childName", "school"].includes(key)) this.setData({ [`values.${key}`]: event.detail.value });
  },
  picker(event: WechatMiniprogram.PickerChange) {
    const key = String(event.currentTarget.dataset.field);
    if (["relation", "gender", "grade"].includes(key)) this.setData({ [`selection.${key}`]: Number(event.detail.value) });
  },
  chooseInterests(event: WechatMiniprogram.CheckboxGroupChange) {
    const selectedInterests: Record<string, boolean> = {};
    event.detail.value.forEach(id => { selectedInterests[id] = true; });
    this.setData({ interests: event.detail.value, selectedInterests });
  },
  consent(event: WechatMiniprogram.CheckboxGroupChange) { this.setData({ consent: event.detail.value.includes("yes") }); },
  policy(event: WechatMiniprogram.TouchEvent) {
    const key = event.currentTarget.dataset.kind === "children" ? "children" : "privacy";
    const policy = this.data.policy?.policyText[currentLocale()];
    if (policy) wx.showModal({ title: key === "privacy" ? this.data.words.privacy : this.data.words.childrenPrivacy, content: participantWording(policy[key]), showCancel: false });
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
    const replay = data.replay;
    if (!this.active || data.busy || (replay && (!registrationReplayAvailable() || data.stage !== "family"))) return;
    const form = replay ? this.replayForm : data.policy?.form;
    if (!form || (!replay && (!data.ticket || !data.policy))) return;
    const shown = (id: string) => data.fields.some(field => field.id === id);
    const child = { key: "child-1", childName: shown("childName") ? data.values.childName.trim() : "", school: shown("school") ? data.values.school.trim() : "",
      gender: shown("gender") ? (["", "female", "male"] as const)[data.selection.gender] : "" as const,
      grade: shown("grade") && data.selection.grade > 0 ? data.selection.grade - 2 : null, interests: shown("interests") ? data.interests : [] };
    const answers: FamilyAnswers = { parentName: shown("parentName") ? data.values.parentName.trim() : "",
      relation: shown("relation") ? (["", "mother", "father", "guardian"] as const)[data.selection.relation] : "", ...child, children: [child] };
    delete (answers as FamilyAnswers & { key?: string }).key;
    if (!data.consent || familyAnswerErrors(form, answers).length) { this.setData({ error: data.words.invalid }); return; }
    this.setData({ busy: true, error: "" });
    try {
      this.submissionLocation ??= registrationLocation();
      const location = await this.submissionLocation;
      if (!this.active) return;
      if (replay) {
        this.submissionLocation = null;
        this.setData({ stage: "replay-complete", replayResult: location.status === "granted" ? data.words.locationReady
          : location.status === "declined" ? data.words.locationDeclined : data.words.locationUnavailable,
          replayCapturedAt: location.capturedAt ? new Date(location.capturedAt).toLocaleTimeString() : "" });
        wx.pageScrollTo({ scrollTop: 0, duration: 0 });
        return;
      }
      const policy = data.policy!;
      const family: FamilyRegistration = { ...answers, formVersion: policy.form.version, location, consent: true,
        privacyVersion: policy.privacyVersion, childrenPrivacyVersion: policy.childrenPrivacyVersion };
      const result = await completeWechatFamily(data.ticket, family);
      if (!this.active) return;
      if (result.grade !== null) saveOnboardingPreferences(result.grade);
      clearNavigation(); if (result.participantId) selectParticipant(result.participantId);
      this.submissionLocation = null;
      this.setData({ ticket: "", policy: null }); wx.switchTab({ url: "/pages/discover/index" });
    } catch (error) {
      if (this.active) this.setData({ error: this.authError(error), ...(error instanceof ApiError && ["UNAUTHENTICATED", "FORM_CHANGED"].includes(error.code) ? { stage: "wechat", ticket: "" } : {}) });
    } finally { if (this.active) this.setData({ busy: false }); }
  },
});
