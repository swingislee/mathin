"use client";

import { MoreHorizontal } from "lucide-react";
import type { FamilyFieldId, FamilyForm } from "../../../../contracts/participant-api/onboarding";
import { displayFamilyForm, onboardingChoices, onboardingCopy } from "../../../../contracts/participant-api/onboarding-presentation";
import { FORM_FIELD_BINDINGS } from "./form-fields";
import styles from "./PromotionFormPreview.module.css";

export type FormSelection = FamilyFieldId | "introduction";
export function PromotionFormPreview({ form, en, selected, select, disabled }: {
  form: FamilyForm; en: boolean; selected: FormSelection; select: (value: FormSelection) => void; disabled: boolean;
}) {
  const locale = en ? "en" : "zh", words = onboardingCopy[locale], choices = onboardingChoices(locale);
  const display = displayFamilyForm(form, locale);
  return <div className={styles.phone} aria-label={en ? "Mini Program form preview" : "小程序表单预览"}>
    <div className={styles.navigation} aria-hidden><span>{words.navigationTitle}</span><span className={styles.capsule}><MoreHorizontal size={18} /><span>◉</span></span></div>
    <div className={styles.page}>
      <button type="button" disabled={disabled} className={styles.introduction} data-selected={selected === "introduction"}
        onClick={() => select("introduction")} aria-label={en ? "Edit title and introduction" : "编辑表单标题和填写提示"}>
        <span className={styles.eyebrow}>格致未来思维</span><span className={styles.title}>{display.title}</span>
        <span className={styles.description}>{display.description}</span>
      </button>
      <div className={styles.phoneNumber}>{words.verifiedPhone} · 138****0000</div>
      {display.fields.map(field => <button key={field.id} type="button" disabled={disabled}
        className={styles.field} data-selected={selected === field.id} onClick={() => select(field.id)}
        aria-label={(en ? "Edit " : "编辑") + (en ? FORM_FIELD_BINDINGS[field.id].en : FORM_FIELD_BINDINGS[field.id].zh)} aria-pressed={selected === field.id}>
        <span className={styles.label}>{field.text}<span>{field.requirement}</span></span>
        {field.kind === "interests" ? <span className={styles.interests}>{field.choices.map(option => <span key={option.id}><i />{option.text}</span>)}</span>
          : <span className={styles.input} data-picker={field.kind === "picker"}>{field.kind === "picker" ? choices[field.id][0] : ""}</span>}
      </button>)}
      {!display.fields.length && <p className={styles.empty}>{en ? "Add fields from the field library." : "从字段库添加需要填写的内容"}</p>}
      <div className={styles.consent}><span className={styles.checkbox} /><span>{words.consent}</span></div>
      <div className={styles.policy}><span>{words.privacy}</span><span>{words.childrenPrivacy}</span></div>
      <div className={styles.hint}>{words.locationNote}</div>
      <div className={styles.submit}>{words.complete}</div>
    </div>
  </div>;
}
