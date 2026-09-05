"use client";

import { LoaderCircle, UsersRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { createContext, type ReactNode, useContext, useMemo, useRef, useState } from "react";
import { useAction } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { FollowupChoice } from "./dashboard-page/FollowupChoice";
import { useRouter } from "@/i18n/navigation";
import { assignLeadsAction } from "./actions/leads";
import { updateLeadSelection } from "./lead-selection";

export interface LeadAssigneeOption {
  userId: string;
  displayName: string;
}

interface LeadPoolSelectionValue {
  selected: ReadonlySet<string>;
  selectedIds: string[];
  assignmentPending: boolean;
  assigneeId: string;
  setAssigneeId: (value: string) => void;
  toggleLead: (leadId: string, checked: boolean, orderedIds: readonly string[], extendRange: boolean) => void;
  setVisibleSelection: (leadIds: readonly string[], checked: boolean) => void;
  assignSelected: () => void;
}

const LeadPoolSelectionContext = createContext<LeadPoolSelectionValue | null>(null);

export function LeadPoolSelectionProvider({
  assignableIds,
  children,
}: {
  assignableIds: string[];
  children: ReactNode;
}) {
  const t = useTranslations("school.leads");
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assigneeId, setAssigneeId] = useState("");
  const selectionAnchorRef = useRef<string | null>(null);
  const selectedIds = useMemo(
    () => assignableIds.filter((id) => selected.has(id)),
    [assignableIds, selected],
  );

  const assignRun = useAction(assignLeadsAction, {
    successMessage: t("assignSuccess"),
    errorMessage: {
      TARGET_CANNOT_FOLLOW_UP: t("assigneeUnavailable"),
      LEAD_SCOPE_MISMATCH: t("assignmentStale"),
      default: t("assignFailed"),
    },
    onSuccess: () => {
      setSelected(new Set());
      selectionAnchorRef.current = null;
      router.refresh();
    },
  });

  const toggleLead = (
    leadId: string,
    checked: boolean,
    orderedIds: readonly string[],
    extendRange: boolean,
  ) => {
    const anchorId = selectionAnchorRef.current;
    const canExtend = extendRange && anchorId !== null && orderedIds.includes(anchorId);
    setSelected((current) => updateLeadSelection({
      current,
      orderedIds,
      leadId,
      checked,
      anchorId,
      extendRange: canExtend,
    }));
    if (!canExtend) selectionAnchorRef.current = leadId;
  };

  const setVisibleSelection = (leadIds: readonly string[], checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      for (const leadId of leadIds) {
        if (checked) next.add(leadId);
        else next.delete(leadId);
      }
      return next;
    });
    selectionAnchorRef.current = null;
  };

  const value: LeadPoolSelectionValue = {
    selected,
    selectedIds,
    assignmentPending: assignRun.pending,
    assigneeId,
    setAssigneeId,
    toggleLead,
    setVisibleSelection,
    assignSelected: () => {
      if (selectedIds.length > 0 && assigneeId) assignRun.run(selectedIds, assigneeId);
    },
  };

  return <LeadPoolSelectionContext.Provider value={value}>{children}</LeadPoolSelectionContext.Provider>;
}

export function useLeadPoolSelection(): LeadPoolSelectionValue {
  const value = useContext(LeadPoolSelectionContext);
  if (!value) throw new Error("LeadPoolSelectionProvider is required");
  return value;
}

export function LeadPoolBatchActions({ assignees }: { assignees: LeadAssigneeOption[] }) {
  const t = useTranslations("school.leads");
  const {
    selectedIds,
    assignmentPending,
    assigneeId,
    setAssigneeId,
    assignSelected,
  } = useLeadPoolSelection();

  return (
    <>
      {selectedIds.length > 0 ? <span className="whitespace-nowrap text-[11px] tabular-nums text-muted">
        {t("selectedCount", { count: selectedIds.length })}
      </span> : null}
      <FollowupChoice label={t("chooseAssignee")} value={assigneeId} onValueChange={setAssigneeId} disabled={assignmentPending || assignees.length === 0}
        className="w-36 min-w-0 max-w-56 [&>button]:px-1.5 [&>button]:text-[11px]" options={assignees.map((person) => ({ value: person.userId, label: person.displayName }))} />
      <Button
        type="button"
        size="sm"
        className="h-8 shrink-0 gap-1 whitespace-nowrap px-2 text-xs"
        disabled={assignmentPending || selectedIds.length === 0 || !assigneeId}
        onClick={assignSelected}
      >
        {assignmentPending
          ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
          : <UsersRound className="size-4" />}
        {t("assignSelected")}
      </Button>
    </>
  );
}
