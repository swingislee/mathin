import type { ResolvedBindingUrls } from "@/features/courseware-doc/resolve";
import type { TeacherMicrocoursePageDoc } from "@/features/teacher-microcourses/page-doc";

export interface PublicClassTeachingBinding {
  bindingKey: string;
  assetRevisionId: string;
  role: string | null;
  kind: string | null;
  storagePath: string | null;
}

export interface PublicClassTeachingPage {
  pageDocId: string;
  pageNo: number;
  title: string;
  revisionId: string;
  aspect: string;
  doc: TeacherMicrocoursePageDoc;
  bindings: PublicClassTeachingBinding[];
  bindingUrls: ResolvedBindingUrls;
}

export interface PublicClassTeachingCourseware {
  releaseId: string | null;
  frozen: boolean;
  ready: boolean;
  pages: PublicClassTeachingPage[];
}
