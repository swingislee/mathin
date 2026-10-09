"use client";

import { useEffect, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { STUDENT_360_REFRESH_EVENT } from "../student-360-contract";
import { FamilyVerificationEditor } from "./FamilyVerificationEditor";
import { readWechatFamily } from "./actions";
import type { PromotionRecord } from "./contract";

/** On-demand source detail within the existing lead/student workspace. */
export function WechatFamilyDetails({ studentId, leadId, locale }: { studentId: string | null; leadId: string | null; locale: string }) {
  const en = locale.startsWith("en"), t = (zh: string, english: string) => en ? english : zh, router = useRouter();
  const [record, setRecord] = useState<PromotionRecord | null>(null), [editing, setEditing] = useState(false), [error, setError] = useState(false), [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!studentId && !leadId) return;
    let active = true;
    readWechatFamily({ studentId, leadId }).then(value => { if (active) { setRecord(value); setError(false); } }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [studentId, leadId, revision]);
  async function refresh() {
    setRecord(await readWechatFamily({ studentId, leadId }));
    router.refresh(); window.dispatchEvent(new Event(STUDENT_360_REFRESH_EVENT));
  }
  if (error) return <p role="alert" className="py-2 text-xs text-rose">{t("微信登记资料暂未读到。", "WeChat registration details could not be loaded.")}<Button type="button" variant="ghost" size="sm" onClick={() => setRevision(value => value + 1)}>{t("重试", "Retry")}</Button></p>;
  if (!record) return null;
  const location = record.location;
  return <section className="border-t border-line py-3" aria-label={t("微信登记来源", "WeChat registration source")}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-medium">{t("微信登记资料", "WeChat registration")}</h3>
      {record.canVerify && !editing && <Button type="button" variant="secondary" size="sm" onClick={() => setEditing(true)}>{t("核实／补充家庭资料", "Verify / complete family details")}</Button>}</div>
    <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted"><span>{record.promoter || t("直接进入", "Direct entry")} · {new Date(record.at).toLocaleString(en ? "en-GB" : "zh-CN", { timeZone: "Asia/Shanghai" })}</span>
      <span>{t("家长原填称呼：", "Parent’s original name: ")}{record.parentName || t("未填写", "Not provided")}</span>
      <span>{record.verifiedAt ? t(`已由 ${record.verifiedBy || "工作人员"} 核实`, `Verified by ${record.verifiedBy || "staff"}`) : t("家长自填，待沟通核实", "Parent-provided; awaiting verification")}</span>
      {location?.status === "granted" && location.latitude !== undefined && location.longitude !== undefined
        ? <a className="underline underline-offset-4" target="_blank" rel="noreferrer" href={`https://apis.map.qq.com/uri/v1/marker?marker=coord:${location.latitude},${location.longitude};title:${encodeURIComponent(t("登记位置", "Registration location"))}&referer=mathin`}>{t("登记位置：", "Registration location: ")}{location.latitude.toFixed(5)}, {location.longitude.toFixed(5)}</a>
        : <span>{location?.status === "declined" ? t("位置未授权", "Location not shared") : t("位置未记录", "No location recorded")}</span>}
    </div>
    {!editing && <div className="mt-2 space-y-2 text-sm">{record.children.map(child => {
      const current = record.participants.find(value => value.key === child.key);
      return <div key={child.key}><span>{t("孩子原填称呼：", "Child’s original name: ")}{child.childName || t("未填写", "Not provided")}</span>
        {current && <span className="ml-3 text-muted">{t("档案姓名：", "Profile name: ")}{current.name}</span>}
        {child.interests.length > 0 && <p className="mt-1 text-xs text-muted">{child.interests.map(id => { const option = record.interestOptions.find(value => value.id === id); return option ? option.label[en ? "en" : "zh"] || option.label.zh : id; }).join(" · ")}</p>}
      </div>;
    })}{record.participants.filter(value => !record.children.some(child => child.key === value.key)).map(child => <div key={child.key}>{child.name}<span className="ml-2 text-xs text-muted">{t("后续补充", "Added later")}</span></div>)}</div>}
    {record.state === "existing_record" && <p className="mt-2 text-xs text-muted">{t("已有历史记录，档案关联仍需核对。", "Earlier records exist; the profile match still needs review.")}</p>}
    {editing && <FamilyVerificationEditor row={record} en={en} close={() => setEditing(false)} saved={refresh} />}
  </section>;
}
