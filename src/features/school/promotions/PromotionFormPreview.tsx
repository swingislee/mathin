"use client";

import { Check, ChevronDown, LockKeyhole, MoreHorizontal } from "lucide-react";
import type { FamilyFieldId, FamilyForm } from "../../../../contracts/participant-api/onboarding";
import { FORM_FIELD_BINDINGS } from "./form-fields";
import styles from "./PromotionFormPreview.module.css";

export type FormSelection = FamilyFieldId | "introduction";
export function PromotionFormPreview({ form, en, selected, select, disabled }: {
  form: FamilyForm; en: boolean; selected: FormSelection; select: (value: FormSelection) => void; disabled: boolean;
}) {
  const text = (value: { zh: string; en: string }) => (en ? value.en : value.zh) || value.zh;
  return <div className={styles.phone} aria-label={en ? "Mini Program form preview" : "小程序表单预览"}>
    <div className={styles.navigation}><span>格致未来思维</span><span className={styles.capsule} aria-hidden><MoreHorizontal size={18} /><span>◉</span></span></div>
    <div className={styles.page}>
      <button type="button" disabled={disabled} className={styles.introduction} data-selected={selected === "introduction"}
        onClick={() => select("introduction")} aria-label={en ? "Edit title and introduction" : "编辑表单标题和填写提示"}>
        <span className={styles.eyebrow}>格致未来思维</span><span className={styles.title}>{text(form.title)}</span>
        <span className={styles.description}>{text(form.description)}</span>
      </button>
      <div className={styles.phoneNumber}><LockKeyhole size={13} />{en ? "Phone verified with WeChat" : "手机号由微信授权确认"}</div>
      {form.fields.filter(field => field.mode !== "hidden").map(field => <button key={field.id} type="button" disabled={disabled}
        className={styles.field} data-selected={selected === field.id} onClick={() => select(field.id)}
        aria-label={(en ? "Edit " : "编辑") + (en ? FORM_FIELD_BINDINGS[field.id].en : FORM_FIELD_BINDINGS[field.id].zh)} aria-pressed={selected === field.id}>
        <span className={styles.label}>{text(field.label)}<span>{field.mode === "required" ? en ? " (required)" : "（必填）" : en ? " (optional)" : "（选填）"}</span></span>
        {field.id === "interests" ? <span className={styles.interests}>{field.options?.map(option => <span key={option.id}><i />{text(option.label) || (en ? "New option" : "新选项")}</span>)}</span>
          : <span className={styles.input}><span>{FORM_FIELD_BINDINGS[field.id].kind === "picker" ? en ? "Choose" : "请选择" : en ? "Enter here" : "请填写"}</span>{FORM_FIELD_BINDINGS[field.id].kind === "picker" && <ChevronDown size={14} />}</span>}
      </button>)}
      {!form.fields.some(field => field.mode !== "hidden") && <p className={styles.empty}>{en ? "Add fields from the field library." : "从字段库添加希望家长填写的内容"}</p>}
      <div className={styles.consent}><span className={styles.checkbox}><Check size={12} /></span><span>{en ? "I agree to the privacy and children’s privacy policies and am authorized to provide this child’s details." : "我已阅读并同意隐私政策与儿童隐私保护规则，确认有权为孩子填写资料。"}</span></div>
      <div className={styles.policy}>{en ? "Privacy policy · Children’s privacy" : "隐私政策 · 儿童隐私保护规则"}</div>
      <div className={styles.submit}>{en ? "Create account and discover" : "建立账号，进入发现"}</div>
    </div>
  </div>;
}
