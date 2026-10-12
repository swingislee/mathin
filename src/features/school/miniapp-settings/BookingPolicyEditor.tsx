"use client";
import { defaultBookingPolicy, type BookingPolicy } from "../../../../contracts/participant-api/booking-policy";
import { LocalizedField, settingsField } from "./fields";

export function BookingPolicyEditor({ value, onChange, en }: { value?: BookingPolicy; onChange: (v: BookingPolicy) => void; en: boolean }) {
  const policy = value || defaultBookingPolicy();
  const patch = (v: Partial<BookingPolicy>) => onChange({ ...policy, ...v });
  return <div className="space-y-4">
    <p className="text-sm text-muted">{en ? "Published rules apply to new assessment bookings. Existing bookings keep their cancellation deadline and joining instructions." : "发布后用于新的诊断预约；已有预约保留预约时的取消期限与参加说明。"}</p>
    <div className="grid gap-4 sm:grid-cols-3">
      {([
        ["windowDays", en ? "Booking window (days)" : "可提前预约天数", 1, 56],
        ["bookingCutoffMinutes", en ? "Close bookings before start (minutes)" : "开始前停止预约（分钟）", 0, 10080],
        ["cancellationCutoffMinutes", en ? "Close cancellations before start (minutes)" : "开始前停止取消（分钟）", 0, 10080],
      ] as const).map(([key, label, min, max]) => <label key={key} className="grid gap-1 text-sm">{label}<input className={settingsField} type="number" min={min} max={max} step={1} value={policy[key]} onChange={e => patch({ [key]: Number(e.target.value) })} /></label>)}
    </div>
    <div className="flex flex-wrap gap-5">{(["campus", "online"] as const).map(mode => <label key={mode} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={policy.modes.includes(mode)} onChange={e => patch({ modes: e.target.checked ? [...policy.modes, mode] : policy.modes.filter(m => m !== mode) })} />{mode === "campus" ? (en ? "At campus" : "到校") : (en ? "Online" : "线上")}</label>)}</div>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={policy.selfCancellation} onChange={e => patch({ selfCancellation: e.target.checked })} />{en ? "Allow families to cancel before their deadline" : "允许家长在截止前自行取消"}</label>
    <LocalizedField label={en ? "Booking instructions" : "预约说明"} value={policy.instructions} onChange={instructions => patch({ instructions })} max={2000} multiline />
  </div>;
}
