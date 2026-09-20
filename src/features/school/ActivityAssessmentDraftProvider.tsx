"use client";

import { createContext, useContext, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import type { ActivityAssessmentInput } from "./activity-actions";
import type { AssessmentWorkbenchPublicClassRecord, AssessmentWorkbenchRow } from "./assessment-workbench-contract";

interface AssessmentDraftState {
  aggregate: ActivityAssessmentInput;
  setAggregate: Dispatch<SetStateAction<ActivityAssessmentInput>>;
  publicClass: AssessmentWorkbenchPublicClassRecord | null;
  setPublicClass: Dispatch<SetStateAction<AssessmentWorkbenchPublicClassRecord | null>>;
  savedAggregate: string;
  setSavedAggregate: Dispatch<SetStateAction<string>>;
  savedPublicClass: string;
  setSavedPublicClass: Dispatch<SetStateAction<string>>;
  savingRef: { current: boolean };
  composingRef: { current: boolean };
  pending: boolean;
  setPending: Dispatch<SetStateAction<boolean>>;
}

const AssessmentDraftContext = createContext<AssessmentDraftState | null>(null);

/** 主行和展开行共用同一份草稿与保存状态，避免相互覆盖。 */
export function ActivityAssessmentDraftProvider({ row, children }: { row: AssessmentWorkbenchRow; children: ReactNode }) {
  const [aggregate, setAggregate] = useState<ActivityAssessmentInput>(() => ({
    registrationId: row.registrationId!,
    assessmentBand: row.assessment?.assessmentBand ?? null,
    score: row.assessment?.score ?? null,
    strengths: row.assessment?.strengths ?? "",
    focusAreas: row.assessment?.focusAreas ?? "",
    parentConcerns: row.assessment?.parentConcerns ?? "",
    teacherRecommendation: row.assessment?.teacherRecommendation ?? "",
    recommendedClass: row.assessment?.recommendedClass ?? "",
  }));
  const [publicClass, setPublicClass] = useState(row.publicClassRecord);
  const [savedAggregate, setSavedAggregate] = useState(() => JSON.stringify(aggregate));
  const [savedPublicClass, setSavedPublicClass] = useState(() => JSON.stringify(publicClass));
  const savingRef = useRef(false);
  const composingRef = useRef(false);
  const [pending, setPending] = useState(false);
  return <AssessmentDraftContext.Provider value={{ aggregate, setAggregate, publicClass, setPublicClass, savedAggregate, setSavedAggregate, savedPublicClass, setSavedPublicClass, savingRef, composingRef, pending, setPending }}>{children}</AssessmentDraftContext.Provider>;
}

export function useAssessmentDraft() {
  const state = useContext(AssessmentDraftContext);
  if (!state) throw new Error("ActivityAssessmentDetails requires ActivityAssessmentDraftProvider");
  return state;
}
