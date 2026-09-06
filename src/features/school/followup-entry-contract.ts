import type { LeadContactInput } from "./actions/leads";
import { defaultInvitationState, invitationCanHaveNextContactReminder, type InvitationDraft, type InvitationKind } from "./invitation-contract";
import type { LeadContactOutcome, LeadInterestLevel } from "./lead-contract";

export interface LeadContactDraft {
  note: string;
  wechatState: "" | "yes" | "no";
  interestLevel: LeadInterestLevel | "";
  invitation: InvitationDraft | null;
  nextContactAt: string | null;
}

export function emptyInvitationDraft(kind: InvitationKind = "activity"): InvitationDraft {
  return { kind, state: defaultInvitationState(kind), activityId: null, assessorId: null,
    parentTimeOptions: [], assessorTimeOptions: [], scheduledAt: null, locationText: "", nextContactAt: null };
}

/** 时间、老师、场次及手动推进的阶段均为已登记信息；打开一个页签不算安排。 */
export function invitationHasStageInformation(draft: InvitationDraft | null): boolean {
  return Boolean(draft && (draft.activityId || draft.assessorId || draft.scheduledAt || draft.locationText.trim()
    || draft.parentTimeOptions.length || draft.assessorTimeOptions.length
    || draft.state !== defaultInvitationState(draft.kind)));
}

export function invitationTabSelection(current: InvitationDraft | null, kind: InvitationKind, cached?: InvitationDraft): {
  value: InvitationDraft | null; preview: InvitationDraft; register: boolean;
} {
  const preview = cached ?? (current?.kind === kind ? current : emptyInvitationDraft(kind));
  const register = kind === "waiting_activity" || invitationHasStageInformation(preview);
  return { value: register ? preview : current, preview, register };
}

/** 仅在保存并下一位时归并空白浏览，既有协调信息原样保留。 */
export function invitationForAdvance(draft: InvitationDraft | null, nextContactAt?: string | null): InvitationDraft {
  return invitationHasStageInformation(draft) || draft?.kind === "waiting_activity" ? draft!
    : { ...emptyInvitationDraft("waiting_activity"), nextContactAt: draft?.nextContactAt ?? nextContactAt ?? null };
}

/** 按本次结果投影提交内容，保留调用方的其他草稿，避免借用上次结果或提交隐藏字段。 */
export function leadContactInput(outcome: LeadContactOutcome, draft: LeadContactDraft): LeadContactInput {
  const reachable = outcome === "connected" || outcome === "declined";
  const invitation = outcome === "connected" ? draft.invitation : null;
  const nextContactAt = outcome === "unreachable" || outcome === "declined"
    ? draft.nextContactAt
    : invitation && invitationCanHaveNextContactReminder(invitation) ? invitation.nextContactAt ?? null : null;
  return {
    outcome,
    note: draft.note,
    wechatAdded: reachable && draft.wechatState ? draft.wechatState === "yes" : null,
    interestLevel: reachable && draft.interestLevel ? draft.interestLevel : null,
    invitation: invitation ? { ...invitation, nextContactAt } : null,
    nextContactAt,
  };
}
