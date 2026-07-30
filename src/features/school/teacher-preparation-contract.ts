import { z } from "zod";
import type { StrokeItem } from "@/features/whiteboard/types";

export const LESSON_PLAN_TEMPLATE_VERSION = "mathin-teaching-plan-v1";

export type LessonPlanStatus = "draft" | "pending" | "approved" | "changes_requested";

export interface SessionLessonPlan {
  id: string | null;
  sessionId: string;
  templateVersion: typeof LESSON_PLAN_TEMPLATE_VERSION;
  content: unknown[];
  status: LessonPlanStatus;
  revision: number;
  updatedAt: string | null;
}

export interface LessonPageNote {
  pageDocId: string;
  content: string;
  updatedAt: string;
}

export interface CoursewareAnnotation {
  id: string;
  pageDocId: string;
  content: StrokeItem[];
  version: number;
  updatedAt: string;
}

export interface SolutionRecord {
  id: string;
  source: "upload" | "board";
  pageDocId: string | null;
  revision: number;
  content: Record<string, unknown>;
  updatedAt: string;
}

const pointSchema = z.tuple([
  z.number().finite().min(0).max(1),
  z.number().finite().min(0).max(1),
]);

export const strokeItemSchema = z.object({
  id: z.uuid(),
  mode: z.enum(["ink", "erase"]),
  color: z.enum(["ink", "rose", "leaf", "crater", "cheek", "moon"]),
  wNorm: z.number().finite().positive().max(0.1),
  points: z.array(pointSchema).max(10_000),
}).strict();

export const annotationContentSchema = z.array(strokeItemSchema).max(5_000).refine(
  (value) => new TextEncoder().encode(JSON.stringify(value)).byteLength <= 2 * 1024 * 1024,
  "ANNOTATION_TOO_LARGE",
);

export const lessonPlanContentSchema = z.array(z.unknown()).max(2_000).refine(
  (value) => new TextEncoder().encode(JSON.stringify(value)).byteLength <= 512 * 1024,
  "LESSON_PLAN_TOO_LARGE",
);

/**
 * The template is course content rather than localized chrome. Its stable
 * Chinese wording is shared by zh/en UI so a session never forks into two
 * documents when an editor changes locale.
 */
export function createLessonPlanTemplateV1(): unknown[] {
  const heading = (level: 1 | 2 | 3, content: string) => ({ type: "heading", props: { level }, content });
  const paragraph = (content: string) => ({ type: "paragraph", content });
  return [
    heading(1, "一、课前判断：学情三问"),
    heading(2, "1. 当前学生的学习情况是什么？他们遇到了什么问题？"),
    paragraph("已有基础："),
    paragraph("主要问题："),
    paragraph("典型表现或证据："),
    heading(2, "2. 基于这些问题，老师需要往哪个方向努力？"),
    paragraph("本阶段教学方向："),
    paragraph("优先解决的问题："),
    paragraph("暂时不作为重点的问题："),
    heading(2, "3. 本节课可以在这个方向上为学生提供什么帮助？"),
    paragraph("本节课提供的具体帮助："),
    paragraph("判断学生是否获得帮助的证据："),
    heading(1, "二、课程设计"),
    heading(2, "1. 授课对象"),
    paragraph("年龄群体："),
    paragraph("能力描述："),
    paragraph("班级特点："),
    heading(2, "2. 教学目标"),
    paragraph("知识目标："),
    paragraph("能力目标："),
    paragraph("情感目标："),
    heading(2, "3. 教学流程"),
    paragraph(""),
    heading(2, "4. 教学重难点"),
    paragraph("重点："),
    paragraph("难点："),
    paragraph("学生可能卡住的位置："),
    heading(2, "5. 教学方法"),
    paragraph("主要教学方法："),
    paragraph("使用这些方法的原因："),
    heading(1, "三、作业设计"),
    paragraph("作业内容："),
    paragraph("完成标准："),
    paragraph("与本节课目标的关系："),
    heading(1, "四、课后反思"),
    paragraph("学生实际表现："),
    paragraph("本节课有效的地方："),
    paragraph("本节课需要调整的地方："),
    paragraph("下节课需要调整的地方："),
    paragraph("是否需要更新学情版本："),
  ];
}
