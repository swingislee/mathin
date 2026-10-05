// 只在当前运行中保存返回位置和所选 ID，账号退出时一起清除。
let returnPath = "";
let participantId = "";
const tabs = ["discover", "courses", "account"];
const destinations = /^(?:\/pages\/(?:activity|assessment|register|mistakes|homework|practice|reservations|agenda|course-catalog|course-detail|course-select|course-applications)\/index(?:\?[^#]*)?|\/pages\/(?:discover|courses|account)\/index)$/;

export function openPage(url: string) {
  if (tabs.some(tab => url === `/pages/${tab}/index`)) wx.switchTab({ url });
  else if (destinations.test(url)) wx.navigateTo({ url });
}
export function rememberReturn(url: unknown) {
  returnPath = typeof url === "string" && destinations.test(url) ? url : "";
}
export function resumeAfterLogin() {
  const target = returnPath;
  returnPath = "";
  if (target) openPage(target);
}
export function selectedParticipant() { return participantId; }
export function hasReturn() { return Boolean(returnPath); }
export function selectParticipant(id: string) { participantId = id; }
export function clearNavigation() { returnPath = ""; participantId = ""; }
