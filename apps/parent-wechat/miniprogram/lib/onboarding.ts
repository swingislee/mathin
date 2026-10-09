import type { Session } from "./api-types";
import type { FamilyAnswers, FamilyForm, RegistrationLocation } from "./onboarding-form";
export type { RegistrationLocation } from "./onboarding-form";

export type FamilyRegistration = FamilyAnswers & {
  formVersion?: number; location: RegistrationLocation;
  privacyVersion: string; childrenPrivacyVersion: string; consent: true;
};
export type PhoneResult = { state: "family_required"; ticket: string; form: FamilyForm; maskedPhone: string; privacyVersion: string; childrenPrivacyVersion: string;
  policyText: { zh: { privacy: string; children: string }; en: { privacy: string; children: string } } };
export type RegistrationResult = { state: "authenticated"; session: Session; participantId: string | null; participantIds?: string[]; grade: number | null };

// This proof stays in memory and expires server-side. It is never put in URL or persistent storage.
let currentProof: { ticket: string; scene: string } | null = null;
export function setOnboardingProof(ticket: string, scene = "") { currentProof = { ticket, scene }; }
export function takeOnboardingProof() { const value = currentProof; currentProof = null; return value; }
export function promotionScene(value: string | undefined): string {
  try { const decoded = decodeURIComponent(value || ""); return /^[a-f0-9]{24}$/.test(decoded) ? decoded : ""; }
  catch { return ""; }
}
export function stageForGrade(grade: number) { return grade === -1 ? "k2" : grade === 0 ? "k3" : `g${grade}`; }
export function saveOnboardingPreferences(grade: number) {
  wx.setStorageSync("gezhi.activity-catalog.filters.v1", { stage: stageForGrade(grade) });
}

export const onboardingCopy = {
  zh: {
    navigationTitle: "参与登记", title: "欢迎来到格致", intro: "填写参与信息，发现适合你的公益活动。",
    phone: "授权手机号，继续", phoneNote: "使用微信验证的手机号识别账号、接收活动联系。",
    formTitle: "参与信息", verifiedPhone: "已验证手机号", parentName: "联系人姓名", relation: "与参与人的关系",
    relations: ["母亲", "父亲", "其他监护人"], childName: "参与人姓名", grade: "参与人年级",
    school: "就读学校（选填）", gender: "性别（选填）", genders: ["暂不填写", "女", "男"],
    interests: "感兴趣的内容", interestOptions: [{ id: "math", label: "数学思维" }, { id: "science", label: "科学探索" }, { id: "activities", label: "公益活动" }],
    location: "记录当前地点", locationNote: "提交时经您授权获取一次位置，用于核对推广来源；未授权也可提交。",
    locationReady: "已取得本次定位", locationDeclined: "未授权定位", locationUnavailable: "尚未取得定位",
    consent: "我已阅读并同意隐私政策及未满14周岁参与人隐私保护规则，确认有权填写所提交的资料。",
    privacy: "隐私政策", childrenPrivacy: "未满14周岁参与人隐私保护规则", complete: "完成登记，进入发现",
    busy: "正在准备微信登录…", retry: "重新微信登录", invalid: "请完成标记为必填的内容，并同意隐私规则。",
    denied: "请主动授权手机号，继续登记。", expired: "微信验证已过期，请重新登录；已填写内容会保留在当前页面。",
    existing: "这个手机号或微信已有关联账号，请联系工作人员完成首次绑定或核对账号状态。",
    unavailable: "微信登记服务暂未准备好，请稍后重试。", binding: "已有账号需先在网页“账号安全”中绑定微信，之后即可直接登录。",
    chooseGrade: "选择参与人年级", skipLocation: "暂不提供定位", privacyButton: "查看小程序隐私说明",
  },
  en: {
    navigationTitle: "Participation", title: "Welcome to Gezhi", intro: "Add your details and discover community activities.",
    phone: "Authorize phone and continue", phoneNote: "Your verified WeChat phone identifies your account and supports activity contact.",
    formTitle: "Participation details", verifiedPhone: "Verified phone", parentName: "Contact name", relation: "Relationship to the participant",
    relations: ["Mother", "Father", "Other guardian"], childName: "Participant name", grade: "Participant’s grade",
    school: "School (optional)", gender: "Gender (optional)", genders: ["Prefer not to say", "Female", "Male"],
    interests: "Interests", interestOptions: [{ id: "math", label: "Math thinking" }, { id: "science", label: "Science" }, { id: "activities", label: "Community activities" }],
    location: "Share current location", locationNote: "With permission, your location is captured once at submission to check the promotion source. You can also submit without sharing it.",
    locationReady: "Location received", locationDeclined: "Location not shared", locationUnavailable: "No location yet",
    consent: "I have read and agree to the privacy policy and privacy rules for participants under 14, and am authorized to provide the submitted details.",
    privacy: "Privacy policy", childrenPrivacy: "Privacy for participants under 14", complete: "Complete registration and discover",
    busy: "Preparing WeChat sign-in…", retry: "Sign in with WeChat again", invalid: "Complete the required fields and agree to the privacy policies.",
    denied: "Authorize your phone number to continue registration.", expired: "WeChat verification expired. Sign in again; your form stays on this page.",
    existing: "This phone or WeChat is already linked to an account. Contact staff to link WeChat or check your account status.",
    unavailable: "WeChat registration is not ready yet. Please try again later.", binding: "Link WeChat once in the website’s Account security settings before using it to sign in.",
    chooseGrade: "Choose participant’s grade", skipLocation: "Continue without location", privacyButton: "Mini Program privacy notice",
  },
};
