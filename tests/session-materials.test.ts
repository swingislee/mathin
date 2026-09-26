import { describe, expect, it } from "vitest";
import { materialFileBelongsToSession, materialMessages, materialPlanSchema, materialQuerySchema, materialVideoHref } from "@/features/school/session-materials-contract";

const sessionId = "12345678-1234-4234-9234-123456789abc";
const classroomId = "12345678-1234-4234-9234-123456789def";

describe("教学材料读取合同", () => {
  it("只接收真实课次、班级与材料种类，忽略客户端提交的能力", () => {
    const input = { sessionId, classroomId, kind: "lesson_plan" };
    expect(materialQuerySchema.parse({ ...input, canWrite: true })).toEqual(input);
    expect(materialQuerySchema.safeParse({ ...input, classroomId: "missing" }).success).toBe(false);
    expect(materialQuerySchema.safeParse({ ...input, kind: "private-draft" }).success).toBe(false);
  });
  it("缺少教案保持 null，不产生默认模板", () => {
    expect(materialPlanSchema.parse({ kind: "lesson_plan", plan: null, files: [] }).plan).toBeNull();
  });
  it("附件路径归属具体课次及材料种类", () => {
    expect(materialFileBelongsToSession(`${sessionId}/lesson-plan/教案.pdf`, sessionId, "lesson_plan")).toBe(true);
    expect(materialFileBelongsToSession(`${sessionId}/solution/解析.png`, sessionId, "solution")).toBe(true);
    for (const path of [
      `${classroomId}/lesson-plan/file.pdf`, `${sessionId}/solution/file.pdf`,
      `${sessionId}/lesson-plan/`, `${sessionId}/lesson-plan/../other.pdf`,
      `${sessionId}/lesson-plan/%2e%2e/other.pdf`, `${sessionId}/lesson-plan/..\\other.pdf`,
      `${sessionId}/lesson-plan//other.pdf`,
    ]) expect(materialFileBelongsToSession(path, sessionId, "lesson_plan")).toBe(false);
  });
  it("视频外链接受 HTTPS，异常或可执行链接保持不可打开", () => {
    expect(materialVideoHref("https://example.test/watch?v=1")).toBe("https://example.test/watch?v=1");
    for (const value of ["", "javascript:alert(1)", "data:text/html,test", "http://example.test/video", "https://user:password@example.test/", "//example.test/"]) {
      expect(materialVideoHref(value)).toBeNull();
    }
  });
  it("中英文提供相同阅读与失败状态", () => {
    expect(Object.keys(materialMessages("zh")).sort()).toEqual(Object.keys(materialMessages("en")).sort());
  });
});
