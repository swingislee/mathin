"use client";

// 微课、作业与正式课件共享同一画布和组件目录；各业务注入自己的保存与资源权限。
export {
  CoursewareCompositionWorkbench as InteractiveQuestionEditor,
  type CoursewareCompositionWorkbenchHandle as InteractiveQuestionEditorHandle,
  type CompositionPagePersistence as InteractiveQuestionPersistence,
} from "@/features/teacher-microcourses/CoursewareCompositionWorkbench";
