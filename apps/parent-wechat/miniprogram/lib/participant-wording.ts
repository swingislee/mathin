/** Display copy from older form configurations; field IDs, answers and policy versions stay intact. */
export function participantWording(value: string): string {
  return value
    .replace(/认识你的家庭/g, "参与信息")
    .replace(/家庭信息/g, "参与信息")
    .replace(/家庭资料/g, "参与资料")
    .replace(/识别家庭/g, "识别账号")
    .replace(/家长账号/g, "账号")
    .replace(/儿童个人信息保护规则/g, "未满14周岁参与人个人信息保护规则")
    .replace(/儿童隐私保护规则/g, "未满14周岁参与人隐私保护规则")
    .replace(/家长/g, "联系人")
    .replace(/孩子|子女|儿童|学员|学生/g, "参与人")
    .replace(/妈妈/g, "母亲")
    .replace(/爸爸/g, "父亲")
    .replace(/\bchildren['’]s personal information rules\b/gi, "Personal information rules for participants under 14")
    .replace(/\bchildren['’]s privacy\b/gi, "Privacy for participants under 14")
    .replace(/\byour family\b/gi, match => match[0] === "Y" ? "Your details" : "your details")
    .replace(/\bfamily (details|information)\b/gi, match => match[0] === "F" ? "Participation details" : "participation details")
    .replace(/\bparent account\b/gi, match => match[0] === "P" ? "Account" : "account")
    .replace(/\bparent(?=['’]?s?\b)/gi, match => match[0] === "P" ? "Contact" : "contact")
    .replace(/\bchildren\b/gi, match => match[0] === "C" ? "Participants" : "participants")
    .replace(/\bchild\b/gi, match => match[0] === "C" ? "Participant" : "participant")
    .replace(/\bstudent(s)?\b/gi, match => (match[0] === "S" ? "Participant" : "participant") + (match.endsWith("s") ? "s" : ""));
}

/** Old accounts can have a role word as their generated display name. Actual names are preserved. */
export function participantAccountName(value: string): string {
  return /^(家长|parent)$/i.test(value.trim()) ? "" : value;
}
