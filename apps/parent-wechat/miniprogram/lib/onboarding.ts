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
export function stageForGrade(grade: number) { return grade === -1 ? "k2" : grade === 0 ? "k3" : `g${grade}`; }
export function saveOnboardingPreferences(grade: number) {
  wx.setStorageSync("gezhi.activity-catalog.filters.v1", { stage: stageForGrade(grade) });
}

export const onboardingCopy = {
  zh: { title: "欢迎来到格致", intro: "建立家长账号，发现适合孩子的公益活动。", phone: "授权手机号，继续", phoneNote: "使用微信验证的手机号识别家庭、接收活动联系。", formTitle: "认识你的家庭", verifiedPhone: "已验证手机号", parentName: "家长姓名", relation: "与孩子的关系", relations: ["妈妈", "爸爸", "监护人"], childName: "孩子姓名", grade: "孩子年级", school: "就读学校（选填）", gender: "孩子性别（选填）", genders: ["暂不填写", "女孩", "男孩"], interests: "感兴趣的内容", interestOptions: [{ id: "math", label: "数学思维" }, { id: "science", label: "科学探索" }, { id: "activities", label: "公益活动" }], location: "记录当前地点", locationNote: "授权后只记录本次填写位置，用于核对推广来源。", locationReady: "已取得本次定位", locationDeclined: "未授权定位", locationUnavailable: "尚未取得定位", consent: "我已阅读并同意隐私政策与儿童隐私保护规则，确认有权为孩子填写资料。", privacy: "隐私政策", childrenPrivacy: "儿童隐私保护规则", complete: "建立账号，进入发现", busy: "正在准备微信登录…", retry: "重新微信登录", invalid: "请完成标记为必填的内容，并同意隐私规则。", denied: "需要你主动授权手机号才能建立家长账号。", expired: "微信验证已过期，请重新登录；已填写内容会保留在当前页面。", existing: "这个手机号或微信已有关联账号，请联系工作人员完成首次绑定或核对账号状态。", unavailable: "微信开户服务暂未准备好，请稍后重试。", binding: "已有账号需先在网页“账号安全”中绑定微信，之后即可直接登录。", chooseGrade: "选择孩子年级", skipLocation: "暂不提供定位", privacyButton: "查看小程序隐私说明" },
  en: { title: "Welcome to Gezhi", intro: "Create a parent account and discover community activities for your child.", phone: "Authorize phone and continue", phoneNote: "Your verified WeChat phone identifies your family and supports activity contact.", formTitle: "Your family", verifiedPhone: "Verified phone", parentName: "Parent name", relation: "Relationship", relations: ["Mother", "Father", "Guardian"], childName: "Child name", grade: "Child’s grade", school: "School (optional)", gender: "Gender (optional)", genders: ["Prefer not to say", "Girl", "Boy"], interests: "Interests", interestOptions: [{ id: "math", label: "Math thinking" }, { id: "science", label: "Science" }, { id: "activities", label: "Community activities" }], location: "Share current location", locationNote: "With permission, only this registration location is recorded to identify the promotion source.", locationReady: "Location received", locationDeclined: "Location not shared", locationUnavailable: "No location yet", consent: "I have read and agree to the privacy and children’s privacy policies and am authorized to provide this child’s details.", privacy: "Privacy policy", childrenPrivacy: "Children’s privacy", complete: "Create account and discover", busy: "Preparing WeChat sign-in…", retry: "Sign in with WeChat again", invalid: "Complete the required fields and agree to the privacy policies.", denied: "Authorize your phone number to create your parent account.", expired: "WeChat verification expired. Sign in again; your form stays on this page.", existing: "This phone or WeChat is already linked to an account. Contact staff to link WeChat or check your account status.", unavailable: "WeChat registration is not ready yet. Please try again later.", binding: "Link WeChat once in the website’s Account security settings before using it to sign in.", chooseGrade: "Choose grade", skipLocation: "Continue without location", privacyButton: "Mini Program privacy notice" },
};
