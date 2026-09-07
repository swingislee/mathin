const zh = {
  name: "姓名", phone: "电话", grade: "年级", clearOutcome: "清除选择",
  owner: "学服", notes: "最近备注", updated: "最近更新", source: "来源背景", unsaved: "未保存",
  wechatAdded: "微信已加", wechatMissing: "微信未加", interest: "意向", visitCommitted: "已诺访",
} as const;
const en: Record<keyof typeof zh, string> = {
  name: "Name", phone: "Phone", grade: "Grade", clearOutcome: "Clear selection",
  owner: "Support", notes: "Latest notes", updated: "Last update", source: "Source context", unsaved: "Unsaved",
  wechatAdded: "WeChat added", wechatMissing: "No WeChat", interest: "Interest", visitCommitted: "Visit agreed",
};
export const firstContactRowMessages = (locale: string) => locale.startsWith("zh") ? zh : en;
