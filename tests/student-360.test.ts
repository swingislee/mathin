import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  latestStudent360Phase,
  sortStudent360Events,
  summarizeStudent360Phases,
  type Student360Event,
  type Student360Phase,
} from "@/features/school/student-360-contract";

const root = process.cwd();
const read = (...segments: string[]) => fs.readFileSync(path.join(root, ...segments), "utf8");

function event(id: string, phase: Student360Phase, occurredAt: string): Student360Event {
  return {
    id,
    phase,
    kind: "follow_up",
    occurredAt,
    title: "",
    status: null,
    actorName: null,
    facts: [],
    notes: [],
    important: false,
    source: { kind: "test", id },
  };
}

describe("Student 360", () => {
  it("keeps one newest-first timeline while summarizing the reached business stages", () => {
    const events = sortStudent360Events([
      event("source", "source", "2026-09-01T08:00:00.000Z"),
      event("contact-old", "contact", "2026-09-02T08:00:00.000Z"),
      event("contact-new", "contact", "2026-09-03T08:00:00.000Z"),
      event("assessment", "assessment", "2026-09-04T08:00:00.000Z"),
    ]);
    const phases = summarizeStudent360Phases(events);

    expect(events.map((item) => item.id)).toEqual([
      "assessment",
      "contact-new",
      "contact-old",
      "source",
    ]);
    expect(phases.find((item) => item.phase === "contact")).toMatchObject({
      count: 2,
      latestAt: "2026-09-03T08:00:00.000Z",
    });
    expect(latestStudent360Phase(phases)).toBe("assessment");
  });

  it("aggregates every current journey source behind a lazy, non-modal side page", () => {
    const data = read("src", "features", "school", "student-360.ts");
    const sheet = read("src", "features", "school", "Student360Sheet.tsx");
    const shell = read("src", "features", "school", "DashboardShell.tsx");

    for (const source of [
      "lead_source_records",
      "lead_communications",
      "lead_invitation_events",
      "activity_registrations",
      "assessment_results",
      "public_class_participant_records",
      "student_follow_ups",
      "enrollments",
      "session_attendance",
      "session_reviews",
    ]) {
      expect(data).toContain(`from(\"${source}\")`);
    }
    expect(sheet).toContain("getStudent360Action(subject)");
    expect(sheet).toContain("data-student-360-side-page");
    expect(sheet).toContain("xl:w-[clamp(26rem,40%,46rem)]");
    expect(sheet).toContain("transition-[width,transform,opacity,border-color]");
    expect(sheet).toContain("translate-x-full");
    expect(sheet).not.toContain("SheetContent");
    expect(shell).toContain("<Student360Workspace>");
    expect(sheet).toContain("data-student-360-timeline");
    expect(sheet).not.toContain("<Card");
  });

  it("opens the same student-or-lead journey from both active assessment workbenches", () => {
    const assessment = read("src", "features", "school", "AssessmentUnifiedWorkbench.tsx");
    const publicClass = read("src", "features", "school", "PublicClassWorkspace.tsx");

    expect(assessment).toContain("<Student360Trigger");
    expect(assessment).toContain("studentId: row.studentId, leadId: row.leadId");
    expect(publicClass).toContain("<Student360Trigger");
    expect(publicClass).toContain("studentId: participant.studentId, leadId: participant.leadId");
  });
});
