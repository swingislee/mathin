// 只在当前运行中保存返回位置和所选 ID，账号退出时一起清除。
let returnPath = "";
let loginRequested = false;
let participantId = "";
const tabs = ["discover", "calendar", "account"];
const destinations = /^(?:\/pages\/(?:onboarding|guardian-binding|activity|assessment|register|reflections|records|task|reservations|agenda|activity-catalog|activity-detail|activity-signup|activity-requests|service)\/index(?:\?[^#]*)?|\/pages\/(?:discover|calendar|account)\/index)$/;

export function openPage(url: string) {
  if (tabs.some(tab => url === `/pages/${tab}/index`)) wx.switchTab({ url });
  else if (destinations.test(url)) wx.navigateTo({ url });
}
export function rememberReturn(url: unknown) {
  returnPath = typeof url === "string" && destinations.test(url) ? url : "";
}
export function requestLogin(url: unknown) { rememberReturn(url); loginRequested = true; }
export function takeLoginRequest() { const requested = loginRequested; loginRequested = false; return requested; }
export function cancelLogin() { returnPath = ""; loginRequested = false; }
export function resumeAfterLogin() {
  const target = returnPath;
  cancelLogin();
  if (target) openPage(target);
  return Boolean(target);
}
export function selectedParticipant() { return participantId; }
export function hasReturn() { return Boolean(returnPath); }
export function selectParticipant(id: string) { participantId = id; }
export function clearNavigation() { cancelLogin(); participantId = ""; }
