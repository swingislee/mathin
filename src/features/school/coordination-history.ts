import "server-only";

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export interface WorkHistoryRow {
  id: string;
  title: string;
  description: string;
  domain: string;
  priority: string;
  status: string;
  createdReason: string;
  closedReason: string | null;
  createdAt: string;
  closedAt: string | null;
  creatorName: string;
  assigneeName: string;
  closedByName: string | null;
}

export interface ApprovalHistoryRow {
  id: string;
  title: string;
  domain: string;
  priority: string;
  status: string;
  requestReason: string;
  createdAt: string;
  decidedAt: string | null;
  requesterName: string;
  approverName: string;
  decision: "approved" | "rejected" | null;
  decisionReason: string | null;
  deciderName: string | null;
}

export const listCoordinationHistory = cache(async function listCoordinationHistory(): Promise<{
  workItems: WorkHistoryRow[];
  approvals: ApprovalHistoryRow[];
}> {
  const supabase = await createClient();
  const [workResult, approvalResult] = await Promise.all([
    supabase
      .from("work_items")
      .select(`
        id,title,description,domain,priority,status,created_reason,closed_reason,created_at,closed_at,
        creator:profiles!work_items_created_by_fkey(display_name),
        assignee:profiles!work_items_assignee_id_fkey(display_name),
        closer:profiles!work_items_closed_by_fkey(display_name)
      `)
      .order("created_at", { ascending: false })
      .limit(100)
      .returns<Array<{
        id: string;
        title: string;
        description: string;
        domain: string;
        priority: string;
        status: string;
        created_reason: string;
        closed_reason: string | null;
        created_at: string;
        closed_at: string | null;
        creator: { display_name: string } | null;
        assignee: { display_name: string } | null;
        closer: { display_name: string } | null;
      }>>(),
    supabase
      .from("approval_requests")
      .select(`
        id,title,domain,priority,status,request_reason,created_at,decided_at,
        requester:profiles!approval_requests_requester_id_fkey(display_name),
        approver:profiles!approval_requests_approver_id_fkey(display_name),
        decision:approval_decisions(
          decision,decision_reason,decided_at,
          decider:profiles!approval_decisions_decider_id_fkey(display_name)
        )
      `)
      .order("created_at", { ascending: false })
      .limit(100)
      .returns<Array<{
        id: string;
        title: string;
        domain: string;
        priority: string;
        status: string;
        request_reason: string;
        created_at: string;
        decided_at: string | null;
        requester: { display_name: string } | null;
        approver: { display_name: string } | null;
        decision: {
          decision: "approved" | "rejected";
          decision_reason: string;
          decided_at: string;
          decider: { display_name: string } | null;
        } | null;
      }>>(),
  ]);

  if (workResult.error) throw new Error(workResult.error.message);
  if (approvalResult.error) throw new Error(approvalResult.error.message);

  return {
    workItems: (workResult.data ?? []).map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      domain: row.domain,
      priority: row.priority,
      status: row.status,
      createdReason: row.created_reason,
      closedReason: row.closed_reason,
      createdAt: row.created_at,
      closedAt: row.closed_at,
      creatorName: row.creator?.display_name ?? "—",
      assigneeName: row.assignee?.display_name ?? "—",
      closedByName: row.closer?.display_name ?? null,
    })),
    approvals: (approvalResult.data ?? []).map((row) => ({
      id: row.id,
      title: row.title,
      domain: row.domain,
      priority: row.priority,
      status: row.status,
      requestReason: row.request_reason,
      createdAt: row.created_at,
      decidedAt: row.decision?.decided_at ?? row.decided_at,
      requesterName: row.requester?.display_name ?? "—",
      approverName: row.approver?.display_name ?? "—",
      decision: row.decision?.decision ?? null,
      decisionReason: row.decision?.decision_reason ?? null,
      deciderName: row.decision?.decider?.display_name ?? null,
    })),
  };
});
