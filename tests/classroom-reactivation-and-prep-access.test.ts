import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (...segments: string[]) => fs.readFileSync(path.join(root, ...segments), "utf8");

describe("classroom reactivation and free-session courseware access", () => {
  it("allows only the explicit completed-to-active lifecycle reversal", () => {
    const migration = read("supabase", "migrations", "20260827000800_classroom_reactivation.sql");

    expect(migration).toContain("classroom_row.operational_status = 'completed' and p_target = 'active'");
    expect(migration).not.toContain("classroom_row.operational_status = 'completed' and p_target = 'planning'");
    expect(migration).toContain("'classroom.lifecycle.transition'");
  });

  it("shows the relevant lifecycle action instead of leaving disabled controls", () => {
    const settings = read("src", "features", "school", "ClassroomSettingsSheet.tsx");

    expect(settings).toContain('classroom.operationalStatus === "completed"');
    expect(settings).toContain('"lifecycleReactivate"');
    expect(settings).toContain('classroom.operationalStatus === "active"');
  });

  it("keeps authoring scoped to assigned teachers and explains read-only management views", () => {
    const workspace = read("src", "features", "school", "SessionWorkspaceBody.tsx");
    const prepPanel = read("src", "features", "school", "SessionPrepPanel.tsx");
    const prepArtifacts = read("src", "features", "school", "session-preparation-artifacts.ts");
    const microcourseCore = read("supabase", "migrations", "20260826000200_teacher_microcourses_core.sql");

    expect(workspace).toContain('detail.capabilities.canPrepare');
    expect(workspace).toContain('t("editCourseware")');
    expect(prepPanel).toContain('t("prepReadOnlyNotTeacherTitle")');
    expect(prepPanel).toContain('t("prepReadOnlyNotTeacherBody")');
    expect(prepPanel).toContain("getSessionPreparationArtifacts(detail.id, regularPreparationEditing)");
    expect(prepPanel).toContain("canReadSessionMemberState ? getSessionLearningSetup(detail.id) : Promise.resolve(null)");
    expect(prepArtifacts).toContain("includeReviewerCandidates = true");
    expect(microcourseCore).toContain("and public.is_session_teacher(microcourse_row.source_session_id, p_uid)");
  });
});
