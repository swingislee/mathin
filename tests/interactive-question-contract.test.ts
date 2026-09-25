import { describe, expect, it, vi } from "vitest";
import { questionCompositionFromText, questionGroupsSchema, orderedQuestionIds, interactiveBindingKeys } from "@/features/interactive-questions/contract";
import { trustedQuestionComposition } from "@/features/interactive-questions/server";
import { bindHomeworkQuestion, createHomeworkQuestions, homeworkCompositionFor, homeworkDocumentSchema, homeworkGroups } from "@/features/school/homework-document-contract";
import { createCoursewareInsertedImageNode } from "@/features/courseware-doc/courseware-inserted-node";
import { addCoursewareCompositionNode } from "@/features/courseware-doc/composition-page-layout";
import fixtures from "../scripts/sql/fixtures/interactive-homework.json";
import { coursewareCompositionPageSchema } from "@/features/courseware-doc/composition-page-schema";
vi.mock("server-only", () => ({}));
const id = "12345678-1234-4234-9234-123456789abc", second = "12345678-1234-4234-9234-123456789def";

describe("shared interactive questions", () => {
  it("keeps the SQL roundtrip fixtures aligned with all shared component schemas", () => {
    for (const doc of Object.values(fixtures)) expect(coursewareCompositionPageSchema.safeParse(doc).success).toBe(true);
  });
  it("keeps independent composition and answer copies when binding a research question", () => {
    const original = createHomeworkQuestions(1)[0], source = { ...createHomeworkQuestions(1)[0], composition: questionCompositionFromText("题干"), answerComposition: questionCompositionFromText("答案") };
    const copied = bindHomeworkQuestion(original, source);
    source.composition.overlay.nodes[0].content!.text = "later change";
    expect(copied.composition!.overlay.nodes[0].content!.text).toBe("题干");
    expect(copied.answerComposition!.overlay.nodes[0].content!.text).toBe("答案");
    expect(copied.id).toBe(original.id);
  });
  it("preserves old plain questions, empty named groups and student-specific composition", () => {
    const doc = homeworkDocumentSchema.parse({ topic: "", instructions: "", lessonPlan: "", dueAt: null, questions: createHomeworkQuestions(1, "基础过关"), overrides: [], groups: ["能力提升"] });
    expect(homeworkGroups(doc)).toEqual(["能力提升", "基础过关"]);
    doc.questions[0].composition = questionCompositionFromText("common");
    doc.overrides = [{ studentId: id, questionId: doc.questions[0].id, content: "individual", composition: null }];
    expect(homeworkCompositionFor(doc, doc.questions[0].id, id)).toBeNull();
    expect(homeworkCompositionFor(doc, doc.questions[0].id)).toBe(doc.questions[0].composition);
  });
  it("orders groups and ungrouped questions without allowing duplicate membership", () => {
    const groups = [{ id, name: "基础过关", questionIds: [second] }];
    expect(orderedQuestionIds([id, second], groups)).toEqual([second, id]);
    expect(questionGroupsSchema.safeParse([...groups, { id: second, name: "能力提升", questionIds: [second] }]).success).toBe(false);
  });
  it("extracts resource keys and sanitizes rich text at both save and read boundaries", () => {
    let doc = questionCompositionFromText("Question");
    const node = doc.overlay.nodes[0];
    node.adapter = "rich_text"; node.content = { kind: "rich_text", html: '<p onclick="alert(1)">题干<script>alert(2)</script><span class="math-tex">x</span></p>', sanitized: true };
    doc = addCoursewareCompositionNode(doc, createCoursewareInsertedImageNode("a".repeat(64), 2, doc.canvas), { columnSpan: 4, rowSpan: 4 });
    const trusted = trustedQuestionComposition(doc);
    expect(trusted.overlay.nodes[0].content!.html).toBe('<p>题干<span class="math-tex">x</span></p>');
    expect(interactiveBindingKeys(trusted)).toEqual(["a".repeat(64)]);
    expect(JSON.stringify(trusted)).not.toContain("signedUrl");
  });
});
