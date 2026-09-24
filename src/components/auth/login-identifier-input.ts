export const COMMON_EMAIL_DOMAINS = ["qq.com", "163.com", "126.com", "gmail.com", "outlook.com", "hotmail.com", "icloud.com", "foxmail.com"] as const;
export type EmailInputParts = { localPart: string; domain: string };

/** 粘贴或自动填充完整邮箱时拆分展示；独立编辑用户名时保留已选域名。 */
export function splitEmailInput(value: string, currentDomain: string): EmailInputParts {
  const input = value.trim();
  const separator = input.indexOf("@");
  return separator < 0 ? { localPart: input, domain: currentDomain }
    : { localPart: input.slice(0, separator), domain: input.slice(separator + 1).trim().toLowerCase() };
}

export function emailInputIdentifier({ localPart, domain }: EmailInputParts) {
  return localPart.trim() && domain.trim() ? `${localPart.trim()}@${domain.trim()}` : "";
}

/** +86 是当前唯一可选区号；完整中国号码可直接粘贴，其他前缀留给表单校验拒绝。 */
export function mainlandPhoneInput(value: string) {
  const input = value.trim().replace(/[\s().-]/g, "");
  if (/^(?:\+86|0086)/.test(input)) return input.replace(/^(?:\+86|0086)/, "");
  return /^861[3-9]\d{9}$/.test(input) ? input.slice(2) : input;
}

export function phoneInputIdentifier(value: string) {
  const national = mainlandPhoneInput(value);
  return national ? `+86${national}` : "";
}
