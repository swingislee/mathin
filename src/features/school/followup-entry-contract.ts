import type { LeadContactInput } from "./actions/leads";
import { invitationCanHaveNextContactReminder, type InvitationDraft } from "./invitation-contract";
import type { LeadContactOutcome, LeadInterestLevel } from "./lead-contract";

export interface LeadContactDraft {
  note: string;
  wechatState: "" | "yes" | "no";
  interestLevel: LeadInterestLevel | "";
  invitation: InvitationDraft | null;
  nextContactAt: string | null;
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
