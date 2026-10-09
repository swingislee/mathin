import { ApiError, authorizeWechatPhone, bindWechat, completeWechatFamily, loginWithWechat, session, verifiedWechatForm, wechatAuthStatus } from "../../lib/api";
import { pageData, currentLocale, errorText, loginPage } from "../../lib/page";
import { clearNavigation, selectParticipant } from "../../lib/navigation";
import { onboardingCopy, promotionScene, saveOnboardingPreferences, takeOnboardingProof, type FamilyRegistration, type PhoneResult, type RegistrationLocation } from "../../lib/onboarding";
import { familyAnswerErrors, type FamilyField, type FamilyForm } from "../../lib/onboarding-form";
import { registrationLocation } from "../../lib/registration-location";
import { participantWording } from "../../lib/participant-wording";

type DisplayField = FamilyField & { text: string; kind: "text" | "picker" | "interests"; choices: { id: string; text: string }[] };
Page({
  data: { ...pageData("account"), words: onboardingCopy.zh, stage: "wechat", busy: false, ticket: "", scene: "", maskedPhone: "",
    canBindDirect: false, password: "", participantIndex: 0, participantChoices: [] as string[],
    values: { parentName: "", childName: "", school: "" }, selection: { relation: 0, gender: 0, grade: 0 },
    choices: {} as Record<string, string[]>, fields: [] as DisplayField[], formTitle: "", formDescription: "",
    interests: [] as string[], selectedInterests: {} as Record<string, boolean>, consent: false,
    policy: null as PhoneResult | null },
  active: true,
  submissionLocation: null as Promise<RegistrationLocation> | null,
  onLoad(query: Record<string,string | undefined>) {
    this.active = true;
    this.submissionLocation = null;
    const locale = currentLocale(), words = onboardingCopy[locale];
    wx.setNavigationBarTitle({ title: words.navigationTitle });
    this.setData({ locale, words, choices: {
      relation: [locale === "zh" ? "请选择" : "Choose", ...words.relations], gender: words.genders,
      grade: locale === "zh" ? [words.chooseGrade, "幼中班", "幼大班", "一年级", "二年级", "三年级", "四年级", "五年级", "六年级", "初一", "初二", "初三", "高一", "高二", "高三"]
        : [words.chooseGrade, "K2", "K3", ...Array.from({ length: 12 }, (_, index) => `Grade ${index + 1}`)],
    } });
    const proof = takeOnboardingProof();
    const scene = promotionScene(query.scene || proof?.scene);
    this.setData({ scene });
    if (proof) void this.acceptProof(proof);
    else void this.start();
  },
  onUnload() { this.active = false; this.submissionLocation = null; this.setData({ ticket: "", policy: null }); },
  discover() { clearNavigation(); wx.switchTab({ url: "/pages/discover/index" }); },
  existingLogin() { loginPage("/pages/onboarding/index" + (this.data.scene ? `?scene=${this.data.scene}` : "")); },
  passwordInput(event: WechatMiniprogram.Input) { this.setData({ password: event.detail.value }); },
  async acceptProof(proof: { ticket: string; phoneVerified?: boolean }) {
    if (!proof.phoneVerified) { this.setData({ ticket: proof.ticket, stage: "phone" }); return; }
    this.setData({ busy: true, stage: "wechat", error: "" });
    try { this.showForm(await verifiedWechatForm(proof.ticket)); }
    catch (error) { if (this.active) this.setData({ ticket: "", stage: "wechat", error: this.authError(error) }); }
    finally { if (this.active) this.setData({ busy: false }); }
  },
  async confirmBinding() {
    if (this.data.busy || (!this.data.canBindDirect && !this.data.password)) return;
    this.setData({ busy: true, error: "" });
    try {
      await bindWechat(this.data.canBindDirect ? undefined : this.data.password);
      if (!this.active) return;
      this.setData({ busy: false, password: "" });
      await this.start();
    } catch (error) { if (this.active) this.setData({ error: this.authError(error) }); }
    finally { if (this.active) this.setData({ busy: false, password: "" }); }
  },
  async start() {
    if (this.data.busy) return;
    this.setData({ busy: true, error: "", stage: "wechat", ticket: "" });
    try {
      const current = Boolean(session());
      if (current) {
        const status = await wechatAuthStatus();
        if (!this.active) return;
        if (status.registrationRequired === false && !this.data.scene) { this.discover(); return; }
        if (!status.linked) {
          if (!status.canBind) throw new ApiError("ACCOUNT_SECURITY");
          this.setData({ stage: "bind", canBindDirect: Boolean(status.canBindDirect) }); return;
        }
      }
      const result = await loginWithWechat(this.data.scene || undefined, current);
      if (!this.active) return;
      if (result.state === "authenticated" || result.state === "current_session") this.discover();
      else if (result.state === "onboarding_required") await this.acceptProof(result);
      else this.setData({ error: this.data.words.binding });
    } catch (error) { if (this.active) this.setData({ error: this.authError(error) }); }
    finally { if (this.active) this.setData({ busy: false }); }
  },
  showForm(policy: PhoneResult) {
    if (!this.active) return;
    this.configureForm(policy.form);
    const participants = policy.existingParticipants || [];
    this.setData({ stage: "family", ticket: policy.ticket, maskedPhone: policy.maskedPhone, policy,
      participantChoices: [...participants.map(row => row.childName), this.data.words.newParticipant], participantIndex: 0 });
    if (participants.length) this.selectExistingParticipant(0);
  },
  selectExistingParticipant(index: number) {
    const participant = this.data.policy?.existingParticipants?.[index];
    this.setData({ participantIndex: index, "values.childName": participant?.childName || "", "values.school": participant?.school || "",
      "selection.grade": participant?.grade != null ? participant.grade + 2 : 0,
      "selection.gender": participant?.gender === "female" ? 1 : participant?.gender === "male" ? 2 : 0 });
  },
  chooseParticipant(event: WechatMiniprogram.PickerChange) { this.selectExistingParticipant(Number(event.detail.value)); },
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
    if (this.data.busy || !this.data.ticket) return;
    if (!event.detail.code) { this.setData({ error: this.data.words.denied }); return; }
    this.setData({ busy: true, error: "" });
    try {
      const policy = await authorizeWechatPhone(this.data.ticket, event.detail.code);
      this.showForm(policy);
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
    if (!this.active || data.busy || !data.ticket || !data.policy) return;
    const shown = (id: string) => data.fields.some(field => field.id === id);
    const participant = data.policy.existingParticipants?.[data.participantIndex];
    const child = { key: "child-1", ...(participant ? { participantId: participant.id } : {}), childName: shown("childName") ? data.values.childName.trim() : "", school: shown("school") ? data.values.school.trim() : "",
      gender: shown("gender") ? (["", "female", "male"] as const)[data.selection.gender] : "" as const,
      grade: shown("grade") && data.selection.grade > 0 ? data.selection.grade - 2 : null, interests: shown("interests") ? data.interests : [] };
    const family: FamilyRegistration = { parentName: shown("parentName") ? data.values.parentName.trim() : "",
      relation: shown("relation") ? (["", "mother", "father", "guardian"] as const)[data.selection.relation] : "", ...child, children: [child],
      formVersion: data.policy.form.version, location: { status: "unavailable" }, consent: true,
      privacyVersion: data.policy.privacyVersion, childrenPrivacyVersion: data.policy.childrenPrivacyVersion };
    delete (family as FamilyRegistration & { key?: string }).key;
    delete (family as FamilyRegistration & { participantId?: string }).participantId;
    if (!data.consent || familyAnswerErrors(data.policy.form, family).length) { this.setData({ error: data.words.invalid }); return; }
    this.setData({ busy: true, error: "" });
    try {
      this.submissionLocation ??= registrationLocation();
      family.location = await this.submissionLocation;
      if (!this.active) return;
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
