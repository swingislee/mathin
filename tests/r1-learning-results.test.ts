import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("R1-6 learning result application contracts", () => {
  it("exposes typed and validated actions for every result transition", () => {
    const actions = read("src/features/school/learning-result-actions.ts");
    for (const rpc of [
      "save_stage_report_draft",
      "submit_learning_result_review",
      "decide_learning_result_review",
      "withdraw_learning_result",
      "withdraw_session_learning_results",
      "publish_session_reviews",
      "withdraw_session_reviews",
      "publish_session_video_review",
    ]) {
      expect(actions).toContain(`rpc("${rpc}"`);
    }
    expect(actions).toContain("parse(stageReportSchema, input)");
    expect(actions).toContain("requiredText(1000)");
    expect(actions).toContain("authorizedClient(\"review.write\")");
    expect(actions).toContain("authorizedClient(\"video.review\")");
  });

  it("keeps session publications explicit and withdrawable", () => {
    const form = read("src/features/school/SessionFamilyBriefForm.tsx");
    const panel = read("src/features/school/SessionFamilyBriefPanel.tsx");
    const data = read("src/features/school/classes.ts");
    const actions = read("src/features/school/learning-result-actions.ts");
    expect(form).toContain("saveSessionFamilyBriefAction(fields)");
    expect(form).toContain("publishSessionFamilyBriefAction(sessionId)");
    expect(actions).toContain('rpc("publish_session_reviews"');
    expect(form).toContain('mode="session"');
    expect(panel).toContain("learningResultStatus_");
    expect(data).toContain('.from("learning_result_heads")');
    expect(data).toContain('.in("kind", ["knowledge_summary", "session_review"])');
  });

  it("separates video review draft, publication, withdrawal, and customer playback", () => {
    const panel = read("src/features/school/VideoReviewPanel.tsx");
    const actions = read("src/features/school/video-actions.ts");
    expect(panel).toContain("reviewVideoAction(videoId, nextComment, nextScore)");
    expect(panel).toContain("publishSessionVideoReviewAction(videoId)");
    expect(panel).toContain('mode="head"');
    expect(panel).toContain("resultStatus_");
    expect(actions).toContain('.eq("kind", "video_review")');
    expect(actions).toContain('.eq("status", "published")');
    expect(actions).toContain("parse(reviewVideoSchema");
  });

  it("provides the complete stage report review workflow", () => {
    const panel = read("src/features/school/StageReportPanel.tsx");
    const studentPage = read("src/app/[locale]/dashboard/students/[studentId]/page.tsx");
    expect(panel).toContain("saveStageReportDraftAction");
    expect(panel).toContain("submitLearningResultReviewAction");
    expect(panel).toContain("decideLearningResultReviewAction");
    expect(panel).toContain("metricVersion");
    expect(panel).toContain("dataCutoffAt");
    expect(panel).toContain('decision: "changes_requested"');
    expect(panel).toContain('decision: "publish"');
    expect(studentPage).toContain('kind: "stage_report"');
    expect(studentPage).toContain("canWriteStageReports");
  });

  it("keeps all new workflow copy bilingual", () => {
    const zh = JSON.parse(read("messages/zh.json"));
    const en = JSON.parse(read("messages/en.json"));
    for (const messages of [zh, en]) {
      expect(messages.school.learningResults.stageReportsTitle).toBeTruthy();
      expect(messages.school.learningResults.status_revised).toBeTruthy();
      expect(messages.school.learningResults.withdrawReason).toBeTruthy();
      expect(messages.school.session.learningResultStatus_withdrawn).toBeTruthy();
      expect(messages.school.videos.publishReview).toBeTruthy();
      expect(messages.school.videos.resultStatus_published).toBeTruthy();
    }
  });
});
