import { configuredPage } from "../../lib/native-page";
import { ApiError, authorizeWechatPhone, bindWechat, cancelPendingAuthentication, completeWechatFamily, getRegistrationForm, getRegistrationReceipt, submitRegistration, requestId, loginWithWechat, session, verifiedWechatForm, wechatAuthStatus } from "../../lib/api";
import { pageData, currentLocale, errorText, loginPage, localized, syncPage } from "../../lib/page";
import { cancelLogin, clearNavigation, resumeAfterLogin, selectParticipant } from "../../lib/navigation";
import { clearOnboardingEntry, clearPromotionScene, onboardingCopy, pendingPromotionScene, rememberPromotionScene, saveOnboardingPreferences, takeOnboardingProof, takeOnboardingRequest, type FamilyRegistration, type PhoneResult, type RegistrationLocation } from "../../lib/onboarding";
import { familyAnswerErrors, type FamilyForm } from "../../lib/onboarding-form";
import { displayFamilyForm, onboardingChoices, type DisplayFamilyField } from "../../lib/onboarding-presentation";
import { registrationLocation } from "../../lib/registration-location";
import { participantWording } from "../../lib/participant-wording";
import type { QuestionAnswers } from "../../lib/form-questions";
import { catalogStages } from "../../lib/catalog";
import { miniappText } from "../../lib/miniapp-settings";

configuredPage("onboarding")({
  data: { ...pageData("account"), words: onboardingCopy.zh, stage: "wechat", busy: false, ticket: "", scene: "", maskedPhone: "",
    registration: false, registrationId: "", registrationKey: "",
    canBindDirect: false, participantIndex: 0, participantChoices: [] as string[],
    values: { parentName: "", childName: "", school: "" }, selection: { relation: 0, gender: 0, grade: 0 },
    choices: {} as Record<string, string[]>, fields: [] as DisplayFamilyField[], formTitle: "", formDescription: "",
    interests: [] as string[], selectedInterests: {} as Record<string, boolean>, consent: false,
    policy: null as PhoneResult | null, extraAnswers: {} as QuestionAnswers, gradeValues: [null] as (number | null)[] },
  active: true,
  submissionLocation: null as Promise<RegistrationLocation> | null,
  onLoad(query: Record<string,string | undefined>) {
    rememberPromotionScene(query.scene);
    if (!takeOnboardingRequest()) { this.discover(); return; }
    this.active = true;
    this.submissionLocation = null;
    const locale = currentLocale(), words = onboardingCopy[locale];
    wx.setNavigationBarTitle({ title: words.navigationTitle });
    this.setData({ locale, words, copy: localized(locale), choices: onboardingChoices(locale), registration: query.registration === "1" });
    if (this.data.registration) { wx.setNavigationBarTitle({ title: this.data.copy.registrationTitle }); void this.start(); return; }
    const proof = takeOnboardingProof();
    const scene = proof?.scene || pendingPromotionScene();
    this.setData({ scene });
    if (proof) void this.acceptProof(proof);
    else void this.start();
  },
  onUnload() {
    if (this.active) cancelLogin();
    this.active = false; this.submissionLocation = null;
    cancelPendingAuthentication(); clearOnboardingEntry();
    this.setData({ busy: false, ticket: "", policy: null });
  },
  onShow() { syncPage(this, "account"); this.refreshGradeChoices(); },
  configurationChanged() { this.refreshGradeChoices(); },
  refreshGradeChoices(selected?: number | null) {
    const value = selected === undefined ? this.data.gradeValues[this.data.selection.grade] ?? null : selected;
    const all = this.data.policy?.form.stages || catalogStages(true);
    const visible = all.filter(row => row.visible || row.stageNumber === value), rows = visible.length ? visible : all;
    const gradeValues = [null, ...rows.map(row => row.stageNumber)];
    this.setData({ gradeValues, "choices.grade": [this.data.words.chooseGrade, ...rows.map(row => miniappText(row.label, currentLocale()))], "selection.grade": Math.max(0, gradeValues.indexOf(value)) });
  },
  discover() {
    if (this.data.busy && (this.data.stage === "family" || this.data.stage === "bind")) return;
    this.onUnload(); clearNavigation(); wx.switchTab({ url: "/pages/discover/index" });
  },
  finish() { if (!this.active) return; clearPromotionScene(this.data.scene); if (!resumeAfterLogin()) wx.switchTab({ url: "/pages/account/index" }); },
  async acceptProof(proof: { ticket: string; phoneVerified?: boolean }) {
    if (!this.active) return;
    if (!proof.phoneVerified) { this.setData({ ticket: proof.ticket, stage: "phone" }); return; }
    this.setData({ busy: true, stage: "wechat", error: "" });
    try { this.showForm(await verifiedWechatForm(proof.ticket)); }
    catch (error) { if (this.active) this.setData({ ticket: "", stage: "wechat", error: this.authError(error) }); }
    finally { if (this.active) this.setData({ busy: false }); }
  },
  async confirmBinding() {
    if (this.data.busy || !this.data.canBindDirect) return;
    this.setData({ busy: true, error: "" });
    try {
      await bindWechat();
      if (!this.active) return;
      this.setData({ busy: false });
      await this.start();
    } catch (error) { if (this.active) this.setData({ error: this.authError(error) }); }
    finally { if (this.active) this.setData({ busy: false }); }
  },
  async start() {
    if (!this.active || this.data.busy) return;
    this.setData({ busy: true, error: "", stage: "wechat", ticket: "" });
    try {
      if (this.data.registration) {
        if (!session()) { this.active = false; loginPage("/pages/register/index"); return; }
        const form = await getRegistrationForm();
        if (!this.active) return;
        const key = "gezhi.registration.pending." + form.accountId;
        const pending: unknown = wx.getStorageSync(key);
        const id = typeof pending === "string" && /^[a-f0-9-]{36}$/.test(pending) ? pending : requestId();
        this.setData({ registrationId: id, registrationKey: key });
        if (pending && await getRegistrationReceipt(id)) { this.registrationSaved(); return; }
        this.showForm({ ...form, state: "family_required", ticket: "" });
        return;
      }
      const current = Boolean(session());
      if (current) {
        const status = await wechatAuthStatus();
        if (!this.active) return;
        if (status.registrationRequired === false && !this.data.scene) { this.finish(); return; }
        if (!status.linked) {
          if (!status.canBind || !status.canBindDirect) throw new ApiError("ACCOUNT_SECURITY");
          this.setData({ stage: "bind", canBindDirect: true }); return;
        }
      }
      const result = await loginWithWechat(this.data.scene || undefined, current);
      if (!this.active) return;
      if (result.state === "authenticated" || result.state === "current_session") this.finish();
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
    this.refreshGradeChoices();
    if (policy.contact) this.setData({ "values.parentName": policy.contact.name,
      "selection.relation": ["", "mother", "father", "guardian"].indexOf(policy.contact.relation) });
    if (participants.length) this.selectExistingParticipant(0);
  },
  selectExistingParticipant(index: number) {
    const participant = this.data.policy?.existingParticipants?.[index];
    this.setData({ participantIndex: index, "values.childName": participant?.childName || "", "values.school": participant?.school || "",
      "selection.gender": participant?.gender === "female" ? 1 : participant?.gender === "male" ? 2 : 0 });
    this.refreshGradeChoices(participant?.grade ?? null);
  },
  chooseParticipant(event: WechatMiniprogram.PickerChange) { this.selectExistingParticipant(Number(event.detail.value)); },
  configureForm(form: FamilyForm) {
    const { title, description, fields } = displayFamilyForm(form, currentLocale());
    const options = fields.find(field => field.id === "interests")?.choices || [];
    const interests = this.data.interests.filter(id => options.some(option => option.id === id));
    const selectedInterests: Record<string, boolean> = {};
    interests.forEach(id => { selectedInterests[id] = true; });
    this.setData({ fields, formTitle: title, formDescription: description, interests, selectedInterests });
  },
  async phone(event: WechatMiniprogram.CustomEvent<{ code?: string; errMsg?: string }>) {
    if (!this.active || this.data.busy || !this.data.ticket) return;
    if (!event.detail.code) { this.discover(); return; }
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
  questionChange(event: WechatMiniprogram.CustomEvent<{ id: string; value: string | string[] }>) {
    if (!this.data.busy && this.data.policy?.form.questions?.some(q => q.id === event.detail.id)) this.setData({ [`extraAnswers.${event.detail.id}`]: event.detail.value });
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
    if (!this.active || data.busy || (!data.registration && !data.ticket) || !data.policy) return;
    const shown = (id: string) => data.fields.some(field => field.id === id);
    const participant = data.policy.existingParticipants?.[data.participantIndex];
    const child = { key: "child-1", ...(participant ? { participantId: participant.id } : {}), childName: shown("childName") ? data.values.childName.trim() : "", school: shown("school") ? data.values.school.trim() : "",
      gender: shown("gender") ? (["", "female", "male"] as const)[data.selection.gender] : "" as const,
      grade: shown("grade") ? data.gradeValues[data.selection.grade] ?? null : null, interests: shown("interests") ? data.interests : [] };
    const family: FamilyRegistration = { parentName: shown("parentName") ? data.values.parentName.trim() : "",
      relation: shown("relation") ? (["", "mother", "father", "guardian"] as const)[data.selection.relation] : "", ...child, children: [child],
      formVersion: data.policy.form.version, extraAnswers: (data.policy.form.questions || []).reduce<QuestionAnswers>((all, q) => {
        if (data.extraAnswers[q.id] !== undefined) all[q.id] = data.extraAnswers[q.id]; return all;
      }, {}), location: { status: "unavailable" }, consent: true,
      privacyVersion: data.policy.privacyVersion, childrenPrivacyVersion: data.policy.childrenPrivacyVersion };
    delete (family as FamilyRegistration & { key?: string }).key;
    delete (family as FamilyRegistration & { participantId?: string }).participantId;
    if (!data.consent || familyAnswerErrors(data.policy.form, family).length) { this.setData({ error: data.words.invalid }); return; }
    this.setData({ busy: true, error: "" });
    try {
      this.submissionLocation ??= registrationLocation();
      family.location = await this.submissionLocation;
      if (!this.active) return;
      // Persist only an opaque retry key. An interrupted submission is recovered with the same key.
      if (data.registration) wx.setStorageSync(data.registrationKey, data.registrationId);
      const result = data.registration ? await submitRegistration(data.registrationId, family) : await completeWechatFamily(data.ticket, family);
      if (!this.active) return;
      if (result.grade !== null) saveOnboardingPreferences(result.grade);
      selectParticipant(result.participantId || "");
      this.submissionLocation = null;
      if (data.registration) { this.registrationSaved(); return; }
      this.setData({ ticket: "", policy: null }); this.finish();
    } catch (error) {
      if (data.registration && error instanceof ApiError && error.code === "CONFLICT") {
        try { if (await getRegistrationReceipt(data.registrationId)) { if (this.active) this.registrationSaved(); return; } } catch { /* Keep the retry key until a receipt is confirmed. */ }
      }
      if (this.active) this.setData({ error: this.authError(error), ...(error instanceof ApiError && ["UNAUTHENTICATED", "FORM_CHANGED"].includes(error.code) ? { stage: "wechat", ticket: "" } : {}) });
    } finally { if (this.active) this.setData({ busy: false }); }
  },
  registrationSaved() {
    if (!this.active) return;
    wx.removeStorageSync(this.data.registrationKey);
    wx.redirectTo({ url: "/pages/register/index?saved=1" });
  },
});
