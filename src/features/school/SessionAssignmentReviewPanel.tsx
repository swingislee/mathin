"use client";

import { ClipboardCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SubmissionsRoster } from "@/features/classroom/assignments/SubmissionsRoster";
import type { SubmissionRecord } from "@/features/classroom/types";
import type { SessionPublishedAssignment } from "./classes";

export interface SessionAssignmentReviewItem {
  assignment: SessionPublishedAssignment;
  submissions: SubmissionRecord[];
}

export function SessionAssignmentReviewPanel({ items }: { items: SessionAssignmentReviewItem[] }) {
  const t = useTranslations("school.session");
  const assignmentT = useTranslations("classroom.assignments");

  return (
    <section className="rounded-2xl border border-line bg-card p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 font-medium text-ink">
            <ClipboardCheck size={17} aria-hidden="true" />
            {t("assignmentReviewTitle")}
          </h3>
          <p className="mt-1 text-xs text-muted">{t("assignmentReviewHint")}</p>
        </div>
        <Badge variant={items.length > 0 ? "secondary" : "outline"}>
          {t("publishedCount", { count: items.length })}
        </Badge>
      </div>

      {items.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-line px-3 py-5 text-center text-sm text-muted">
          {t("assignmentReviewEmpty")}
        </p>
      ) : (
        <Tabs defaultValue={items[0]!.assignment.id} className="mt-4 min-w-0">
          <TabsList className="flex h-auto max-w-full flex-wrap justify-start">
            {items.map(({ assignment, submissions }) => {
              const submitted = submissions.filter((row) => Boolean(row.id)).length;
              return (
                <TabsTrigger key={assignment.id} value={assignment.id} className="min-w-0 max-w-64 gap-2">
                  <span className="truncate">{assignment.title}</span>
                  <span className="shrink-0 text-xs text-muted">
                    {assignmentT("submissionCount", { done: submitted, total: submissions.length })}
                  </span>
                </TabsTrigger>
              );
            })}
          </TabsList>
          {items.map(({ assignment, submissions }) => (
            <TabsContent key={assignment.id} value={assignment.id}>
              <SubmissionsRoster rows={submissions} />
            </TabsContent>
          ))}
        </Tabs>
      )}
    </section>
  );
}
