export function guardianInvitation(value: string | undefined): string {
  try { const code = decodeURIComponent(value || "").trim().toLowerCase(); return /^[a-f0-9]{32}$/.test(code) ? code : ""; }
  catch { return ""; }
}
export const guardianCopy = {
  zh: {
    title: "关联已有孩子", intro: "由工作人员将孩子的关联码交给您。请先核对部分姓名，确认是您监护的孩子后再关联。",
    boundary: "扫码和登录只用于核对，确认关联前不会显示完整资料。",
    codeLabel: "关联码", codePlaceholder: "输入工作人员提供的关联码", preview: "查看关联邀请", scan: "扫描关联码",
    expires: "有效至", scope: "确认后，可查看孩子资料与学习记录，并为孩子报名、预约。",
    continue: "使用微信继续", phone: "授权手机号以核对账号", phoneNote: "手机号用于建立或核对您的账号。授权后仍需您确认关联。",
    name: "您的姓名", relation: "与孩子的关系", relations: ["请选择", "妈妈", "爸爸", "其他监护人"],
    consent: "我确认是该孩子的监护人，已阅读隐私政策与儿童隐私说明，同意关联已有档案并按上述用途使用资料。",
    privacy: "隐私政策", children: "儿童隐私说明", confirm: "确认关联这个孩子", cancel: "暂不关联，继续浏览",
    done: "关联成功", doneNote: "已关联现有档案，可在“我的”查看孩子。", account: "查看我的孩子",
    unavailable: "关联码无效、已使用、已撤销或已过期，请向工作人员获取新的关联码。",
    conflict: "当前账号与微信不一致，或同一关联正在处理中。请核对登录账号后重试；已确认成功的可到“我的”查看。",
    security: "此手机号已有受保护账号。请先在“我的”登录原账号并绑定微信，再重新关联孩子。",
    denied: "您未授权手机号，孩子尚未关联。可稍后继续。", expired: "核对已过期，请重新使用微信继续。",
    retry: "重新核对", invalid: "请先填入有效的关联码。",
  },
  en: {
    title: "Link an existing child", intro: "Ask staff for your child's invitation. Check the partial name and confirm that you are the child's guardian.",
    boundary: "Scanning and signing in only verify your account. Full details appear after you confirm the link.",
    codeLabel: "Invitation code", codePlaceholder: "Enter the invitation from staff", preview: "View invitation", scan: "Scan invitation",
    expires: "Expires", scope: "After confirmation, you can view the child's profile and learning records, and make bookings.",
    continue: "Continue with WeChat", phone: "Authorize phone to verify account", phoneNote: "Your phone creates or verifies your account. Linking the child still needs your confirmation.",
    name: "Your name", relation: "Relationship", relations: ["Select", "Mother", "Father", "Other guardian"],
    consent: "I confirm I am this child's guardian. I have read the privacy policies and agree to link the existing record for the purposes above.",
    privacy: "Privacy policy", children: "Children's privacy", confirm: "Confirm linking this child", cancel: "Continue browsing",
    done: "Child linked", doneNote: "The existing record is now linked. View your child in My.", account: "View my child",
    unavailable: "This invitation is invalid, used, revoked or expired. Ask staff for a new invitation.",
    conflict: "Your current account does not match this WeChat, or confirmation is in progress. Check your account and retry. If already confirmed, view the child in My.",
    security: "This phone belongs to a protected account. Sign in to that account in My, link WeChat, then return to link the child.",
    denied: "Phone access was declined. The child has not been linked. You can continue later.", expired: "Verification expired. Continue with WeChat again.",
    retry: "Verify again", invalid: "Enter a valid invitation code first.",
  },
};
