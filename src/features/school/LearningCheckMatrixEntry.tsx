"use client";

import { LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  useMemo,
  type CSSProperties,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { LearningCheckStatusIcon } from "./LearningCheckStatusIcon";
import {
  LearningCheckQuickEntryCard,
  LearningCheckQuickEntryGrid,
  type LearningCheckQuickChoice,
} from "./LearningCheckQuickEntryGrid";
import { LearningFillRail, type LearningFillRailLabels } from "./LearningFillRail";
import {
  LEARNING_CHECK_STATUSES,
  LEARNING_SEAT_CAPACITY,
  LEARNING_SEAT_COLUMNS,
  type LearningCheckStatus,
} from "./session-learning-contract";
import { LEARNING_CHECK_STATUS_STYLE } from "./session-learning-visual";

export type LearningCheckMatrixOrientation = "by-question" | "by-student";

export interface LearningCheckMatrixItem<Data> {
  id: string;
  label: string;
  /** Zero-based visual position. It preserves classroom seats and paper question order. */
  slot?: number;
  data: Data;
}

export interface LearningCheckMatrixCell<StudentData, QuestionData> {
  student: LearningCheckMatrixItem<StudentData>;
  question: LearningCheckMatrixItem<QuestionData>;
  status: LearningCheckStatus;
  slot: number;
}

export interface LearningCheckMatrixContext<StudentData, QuestionData> {
  orientation: LearningCheckMatrixOrientation;
  activeStudent: LearningCheckMatrixItem<StudentData> | null;
  activeQuestion: LearningCheckMatrixItem<QuestionData> | null;
}

interface LearningCheckMatrixFill<StudentData, QuestionData> {
  pending: boolean;
  canUndo: boolean;
  onFill: (
    cells: Array<LearningCheckMatrixCell<StudentData, QuestionData>>,
    status: Exclude<LearningCheckStatus, "unchecked">,
  ) => void;
  onUndo: () => void;
  labels?: (remainingCount: number) => LearningFillRailLabels;
}

export interface LearningCheckMatrixEntryProps<StudentData, QuestionData> {
  students: Array<LearningCheckMatrixItem<StudentData>>;
  questions: Array<LearningCheckMatrixItem<QuestionData>>;
  orientation: LearningCheckMatrixOrientation;
  onOrientationChange?: (orientation: LearningCheckMatrixOrientation) => void;
  activeStudentId: string | null;
  activeQuestionId: string | null;
  onActiveStudentChange: (studentId: string) => void;
  onActiveQuestionChange: (questionId: string) => void;
  statusFor: (studentId: string, questionId: string) => LearningCheckStatus;
  onStatusChange: (
    cell: LearningCheckMatrixCell<StudentData, QuestionData>,
    status: LearningCheckStatus,
  ) => void;
  isCellPending?: (cell: LearningCheckMatrixCell<StudentData, QuestionData>) => boolean;
  isCellBulkEligible?: (cell: LearningCheckMatrixCell<StudentData, QuestionData>) => boolean;
  renderCardHeader?: (cell: LearningCheckMatrixCell<StudentData, QuestionData>) => ReactNode;
  renderMobileHeader?: (cell: LearningCheckMatrixCell<StudentData, QuestionData>) => ReactNode;
  renderMobileDetails?: (cell: LearningCheckMatrixCell<StudentData, QuestionData>) => ReactNode;
  renderActiveEditor?: (context: LearningCheckMatrixContext<StudentData, QuestionData>) => ReactNode;
  getCardClassName?: (cell: LearningCheckMatrixCell<StudentData, QuestionData>) => string | undefined;
  getCardStyle?: (cell: LearningCheckMatrixCell<StudentData, QuestionData>) => CSSProperties | undefined;
  getCardProps?: (
    cell: LearningCheckMatrixCell<StudentData, QuestionData>,
  ) => Omit<HTMLAttributes<HTMLElement>, "children" | "className" | "onClick" | "style">;
  renderSlotBackground?: (context: {
    orientation: LearningCheckMatrixOrientation;
    position: number;
    occupied: boolean;
  }) => ReactNode;
  getSlotClassName?: (context: {
    orientation: LearningCheckMatrixOrientation;
    position: number;
    occupied: boolean;
  }) => string | undefined;
  getSlotProps?: (context: {
    orientation: LearningCheckMatrixOrientation;
    position: number;
    occupied: boolean;
  }) => Omit<HTMLAttributes<HTMLElement>, "children" | "className" | "style">;
  fill?: LearningCheckMatrixFill<StudentData, QuestionData>;
  minimumSlots?: number;
  gridRef?: Ref<HTMLDivElement>;
  mobileChoiceDisplay?: "icon" | "label";
  className?: string;
}

const STATUS_SHORTCUTS: Record<string, LearningCheckStatus> = {
  "0": "unchecked",
  "1": "explained",
  "2": "independent",
  "3": "prompted",
  "4": "imitated",
  "5": "incomplete",
};

/**
 * One students × questions entry surface used by both live classrooms and 1:1
 * assessments. This component owns orientation, pivot navigation, the 4 × 5
 * cards, shortcuts, mobile rows and the bulk-fill rail. Consumers only adapt
 * domain data, persistence callbacks and optional metadata editors.
 */
export function LearningCheckMatrixEntry<StudentData, QuestionData>({
  students,
  questions,
  orientation,
  onOrientationChange,
  activeStudentId,
  activeQuestionId,
  onActiveStudentChange,
  onActiveQuestionChange,
  statusFor,
  onStatusChange,
  isCellPending,
  isCellBulkEligible,
  renderCardHeader,
  renderMobileHeader,
  renderMobileDetails,
  renderActiveEditor,
  getCardClassName,
  getCardStyle,
  getCardProps,
  renderSlotBackground,
  getSlotClassName,
  getSlotProps,
  fill,
  minimumSlots = LEARNING_SEAT_CAPACITY,
  gridRef,
  mobileChoiceDisplay = "icon",
  className,
}: LearningCheckMatrixEntryProps<StudentData, QuestionData>) {
  const t = useTranslations("school.session");
  const activeStudent = students.find((student) => student.id === activeStudentId) ?? students[0] ?? null;
  const activeQuestion = questions.find((question) => question.id === activeQuestionId) ?? questions[0] ?? null;
  const axisItems = orientation === "by-question" ? students : questions;
  const pivotItems = orientation === "by-question" ? questions : students;
  const activePivotId = orientation === "by-question" ? activeQuestion?.id : activeStudent?.id;

  const choices = useMemo<LearningCheckQuickChoice<LearningCheckStatus>[]>(() => (
    LEARNING_CHECK_STATUSES.map((status, index) => ({
      value: status,
      visualStatus: status,
      label: t("learningStatus_" + status),
      shortcut: status === "unchecked" ? "0" : String(index + 1),
    }))
  ), [t]);

  const cells = useMemo(() => {
    if (!activeStudent || !activeQuestion) return [];
    return axisItems.map((item, index) => {
      const student = orientation === "by-question"
        ? item as LearningCheckMatrixItem<StudentData>
        : activeStudent;
      const question = orientation === "by-student"
        ? item as LearningCheckMatrixItem<QuestionData>
        : activeQuestion;
      return {
        student,
        question,
        status: statusFor(student.id, question.id),
        slot: item.slot ?? index,
      } satisfies LearningCheckMatrixCell<StudentData, QuestionData>;
    });
  }, [activeQuestion, activeStudent, axisItems, orientation, statusFor]);

  const orderedCells = useMemo(
    () => [...cells].sort((left, right) => left.slot - right.slot),
    [cells],
  );
  const occupiedSlots = useMemo(() => new Set(cells.map((cell) => cell.slot)), [cells]);
  const highestSlot = cells.reduce((highest, cell) => Math.max(highest, cell.slot), -1);
  const requiredSlots = Math.max(minimumSlots, cells.length, highestSlot + 1);
  const slotCount = Math.ceil(requiredSlots / LEARNING_SEAT_COLUMNS) * LEARNING_SEAT_COLUMNS;
  const slots = useMemo(() => Array.from({ length: slotCount }, (_, position) => position), [slotCount]);
  const eligibleCells = cells.filter((cell) => isCellBulkEligible?.(cell) ?? true);
  const uncheckedCells = eligibleCells.filter((cell) => cell.status === "unchecked");
  const checkedCount = eligibleCells.length - uncheckedCells.length;
  const activeCell = cells.find((cell) => (
    cell.student.id === activeStudent?.id && cell.question.id === activeQuestion?.id
  )) ?? orderedCells[0] ?? null;
  const showOrientationSwitch = Boolean(onOrientationChange && students.length > 1 && questions.length > 1);
  const showPivotNavigation = pivotItems.length > 1;

  const activateCell = (cell: LearningCheckMatrixCell<StudentData, QuestionData>) => {
    if (cell.student.id !== activeStudentId) onActiveStudentChange(cell.student.id);
    if (cell.question.id !== activeQuestionId) onActiveQuestionChange(cell.question.id);
  };

  const chooseStatus = (
    cell: LearningCheckMatrixCell<StudentData, QuestionData>,
    status: LearningCheckStatus,
  ) => {
    if (isCellPending?.(cell)) return;
    activateCell(cell);
    onStatusChange(cell, status);
  };

  const moveActiveCell = (offset: number) => {
    if (orderedCells.length === 0) return;
    const currentIndex = Math.max(0, orderedCells.findIndex((cell) => (
      cell.student.id === activeStudent?.id && cell.question.id === activeQuestion?.id
    )));
    const nextCell = orderedCells[Math.max(0, Math.min(orderedCells.length - 1, currentIndex + offset))];
    if (nextCell) activateCell(nextCell);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, select, [contenteditable='true'], [role='listbox']")) return;
    if (
      (event.key === "Enter" || event.key.startsWith("Arrow"))
      && target.closest("button, [role='tab']")
    ) return;
    const status = STATUS_SHORTCUTS[event.key];
    if (status && activeCell) {
      event.preventDefault();
      chooseStatus(activeCell, status);
      return;
    }
    if (event.key === "ArrowRight" || event.key === "ArrowDown" || event.key === "Enter") {
      event.preventDefault();
      moveActiveCell(1);
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      moveActiveCell(-1);
    }
  };

  const progressLabel = orientation === "by-question"
    ? t("learningMatrixStudentProgress", { checked: checkedCount, total: eligibleCells.length })
    : t("learningMatrixQuestionProgress", { checked: checkedCount, total: eligibleCells.length });
  const context: LearningCheckMatrixContext<StudentData, QuestionData> = {
    orientation,
    activeStudent,
    activeQuestion,
  };

  return (
    <div
      className={cn("flex min-h-0 min-w-0 flex-1 flex-col outline-none", className)}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      aria-label={t("learningMatrixWorkspace")}
      data-learning-matrix-entry
      data-learning-matrix-orientation={orientation}
    >
      {(showOrientationSwitch || showPivotNavigation) ? (
        <div className="mb-1 flex min-h-9 shrink-0 items-center gap-2 border-b border-line/70 pb-1" data-learning-matrix-toolbar>
          {showOrientationSwitch ? (
            <Tabs
              value={orientation}
              onValueChange={(value) => onOrientationChange?.(value as LearningCheckMatrixOrientation)}
              aria-label={t("learningMatrixView")}
              className="shrink-0"
            >
              <TabsList className="h-8 p-0.5">
                <TabsTrigger value="by-question" className="h-7 px-2 text-[11px]">
                  {t("learningMatrixByQuestion")}
                </TabsTrigger>
                <TabsTrigger value="by-student" className="h-7 px-2 text-[11px]">
                  {t("learningMatrixByStudent")}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          ) : null}
          {showPivotNavigation ? (
            <div
              className="flex min-w-0 flex-1 gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              role="toolbar"
              aria-label={orientation === "by-question" ? t("learningCheckChoose") : t("learningStudentChoose")}
              data-learning-matrix-pivots
            >
              {pivotItems.map((item, index) => (
                <Button
                  key={item.id}
                  type="button"
                  size="sm"
                  variant={item.id === activePivotId ? "primary" : "secondary"}
                  className="h-8 max-w-40 shrink-0 overflow-hidden text-ellipsis whitespace-nowrap px-2.5 text-[11px]"
                  aria-pressed={item.id === activePivotId}
                  onClick={() => {
                    if (orientation === "by-question") onActiveQuestionChange(item.id);
                    else onActiveStudentChange(item.id);
                  }}
                >
                  {orientation === "by-question" ? `${index + 1}. ` : ""}{item.label}
                </Button>
              ))}
            </div>
          ) : null}
          <span className="shrink-0 text-[11px] tabular-nums text-muted" data-learning-matrix-progress>
            {progressLabel}
          </span>
          {fill?.pending ? <LoaderCircle className="size-3.5 shrink-0 animate-spin text-muted motion-reduce:animate-none" /> : null}
        </div>
      ) : null}

      {renderActiveEditor?.(context)}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col sm:flex-row" data-learning-matrix-body>
        <div className="flex min-h-0 flex-1 flex-col divide-y divide-line overflow-y-auto sm:hidden" data-learning-mobile-list>
          {orderedCells.map((cell) => {
            const pending = isCellPending?.(cell) ?? false;
            const active = cell.student.id === activeStudent?.id && cell.question.id === activeQuestion?.id;
            return (
              <article
                key={`${cell.student.id}:${cell.question.id}`}
                className={cn(
                  "shrink-0 px-1.5 py-1 transition-colors",
                  LEARNING_CHECK_STATUS_STYLE[cell.status].card,
                  active && "ring-2 ring-inset ring-crater/35",
                )}
                onClick={() => activateCell(cell)}
                data-learning-mobile-row
                data-learning-current-status={cell.status}
              >
                <div className="flex min-h-9 min-w-0 items-center gap-1">
                  <div className="min-w-0 flex-1">
                    {renderMobileHeader?.(cell) ?? renderCardHeader?.(cell) ?? (
                      <p className="truncate px-1 text-xs font-medium text-ink">
                        {orientation === "by-question" ? cell.student.label : cell.question.label}
                      </p>
                    )}
                  </div>
                  {pending ? <LoaderCircle className="size-3.5 shrink-0 animate-spin text-muted motion-reduce:animate-none" /> : null}
                </div>
                <div
                  className="grid min-w-0 grid-cols-6 gap-0.5"
                  role="group"
                  aria-label={`${cell.student.label} · ${cell.question.label}`}
                  onClick={(event) => event.stopPropagation()}
                >
                  {choices.map((choice) => {
                    const selected = cell.status === choice.value;
                    const statusStyle = LEARNING_CHECK_STATUS_STYLE[choice.visualStatus];
                    return (
                      <button
                        key={choice.value}
                        type="button"
                        disabled={pending}
                        aria-pressed={selected}
                        aria-label={choice.label}
                        title={`${choice.shortcut} · ${choice.label}`}
                        onClick={() => chooseStatus(cell, choice.value)}
                        className={cn(
                          "grid h-10 min-w-0 place-items-center rounded-md border px-0.5 outline-none transition-[color,background-color,border-color,box-shadow,transform] focus-visible:ring-2 focus-visible:ring-crater active:scale-95 disabled:opacity-55",
                          selected ? statusStyle.active : cn("border-transparent bg-paper/45 text-muted", statusStyle.idle),
                        )}
                      >
                        {mobileChoiceDisplay === "label" ? (
                          <span className="truncate text-[10px] font-medium">{t("learningStatusShort_" + choice.value)}</span>
                        ) : (
                          <LearningCheckStatusIcon
                            status={choice.visualStatus}
                            size={16}
                            className={selected ? "text-current opacity-80" : statusStyle.icon}
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
                {renderMobileDetails ? (
                  <div className="pt-1" onClick={(event) => event.stopPropagation()}>
                    {renderMobileDetails(cell)}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>

        <LearningCheckQuickEntryGrid
          ref={gridRef}
          itemCount={slotCount}
          className="hidden sm:grid"
          data-learning-matrix-grid
          data-learning-seat-columns={LEARNING_SEAT_COLUMNS}
        >
          {slots.map((position) => {
            const occupied = occupiedSlots.has(position);
            const slotContext = { orientation, position, occupied };
            return (
              <article
                key={`matrix-slot-${position}`}
                {...getSlotProps?.(slotContext)}
                style={{
                  gridColumnStart: (position % LEARNING_SEAT_COLUMNS) + 1,
                  gridRowStart: Math.floor(position / LEARNING_SEAT_COLUMNS) + 1,
                }}
                className={cn(
                  "relative flex min-h-0 min-w-0 flex-col items-center justify-center rounded-xl border p-2 text-center text-muted transition-[border-color,background-color,box-shadow]",
                  occupied ? "pointer-events-none border-transparent bg-transparent" : "border-dashed border-line/70 bg-card/20",
                  getSlotClassName?.(slotContext),
                )}
              >
                {renderSlotBackground?.(slotContext) ?? (!occupied ? (
                  <span className="absolute left-2 top-1.5 font-mono text-[9px] text-muted/55" aria-hidden>
                    {String(position + 1).padStart(2, "0")}
                  </span>
                ) : null)}
              </article>
            );
          })}
          {cells.map((cell) => {
            const pending = isCellPending?.(cell) ?? false;
            const active = cell.student.id === activeStudent?.id && cell.question.id === activeQuestion?.id;
            const cardProps = getCardProps?.(cell);
            return (
              <LearningCheckQuickEntryCard
                key={`${cell.student.id}:${cell.question.id}`}
                {...cardProps}
                visualStatus={cell.status}
                selectedValue={cell.status}
                choices={choices}
                choiceGroupLabel={`${cell.student.label} · ${cell.question.label}`}
                disabled={pending}
                onChoice={(status) => chooseStatus(cell, status)}
                onClick={() => activateCell(cell)}
                data-learning-current-status={cell.status}
                aria-current={active ? "true" : undefined}
                style={{
                  gridColumnStart: (cell.slot % LEARNING_SEAT_COLUMNS) + 1,
                  gridRowStart: Math.floor(cell.slot / LEARNING_SEAT_COLUMNS) + 1,
                  ...getCardStyle?.(cell),
                }}
                className={cn(active && "ring-2 ring-crater/40 ring-inset", getCardClassName?.(cell))}
                header={renderCardHeader?.(cell) ?? (
                  <div className="flex min-h-8 min-w-0 items-center gap-1 px-2">
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink">
                      {orientation === "by-question" ? cell.student.label : cell.question.label}
                    </span>
                    {cell.status !== "unchecked" ? (
                      <span className={cn("shrink-0 text-[10px] font-medium", LEARNING_CHECK_STATUS_STYLE[cell.status].icon)}>
                        {t("learningStatusShort_" + cell.status)}
                      </span>
                    ) : null}
                    {pending ? <LoaderCircle className="size-3 shrink-0 animate-spin text-muted motion-reduce:animate-none" /> : null}
                  </div>
                )}
              />
            );
          })}
        </LearningCheckQuickEntryGrid>

        {fill ? (
          <LearningFillRail
            remainingCount={uncheckedCells.length}
            totalCount={eligibleCells.length}
            pending={fill.pending}
            canUndo={fill.canUndo}
            onFill={(status) => fill.onFill(uncheckedCells, status)}
            onUndo={fill.onUndo}
            labels={fill.labels?.(uncheckedCells.length) ?? (orientation === "by-student" ? {
              rail: t("learningQuestionFillRail"),
              remaining: t("learningQuestionFillRemaining", { count: uncheckedCells.length }),
              complete: t("learningQuestionFillComplete"),
              action: (status) => t("learningQuestionFillAction", { count: uncheckedCells.length, status }),
              undo: t("learningFillUndo"),
            } : undefined)}
          />
        ) : null}
      </div>
    </div>
  );
}
