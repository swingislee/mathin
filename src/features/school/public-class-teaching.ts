import "server-only";

import { z } from "zod";
import type { ResolvedBindingUrls } from "@/features/courseware-doc/resolve";
import {
  resolveTeacherMicrocoursePageBindingUrls,
  type TeacherMicrocourseBinding,
} from "@/features/teacher-microcourses/data";
import {
  teacherMicrocoursePageDocSchema,
  type TeacherMicrocoursePageDoc,
} from "@/features/teacher-microcourses/page-doc";
import { createClient } from "@/lib/supabase/server";

type RpcClient = Awaited<ReturnType<typeof createClient>>;
type UntypedRpc = (name: string, args?: Record<string, unknown>) => Promise<{
  data: unknown;
  error: { message: string } | null;
}>;

function rpc(client: RpcClient): UntypedRpc {
  return (client.rpc as unknown as UntypedRpc).bind(client);
}

const uuid = z.uuid();
const bindingSchema = z.object({
  bindingKey: z.string().min(1),
  assetRevisionId: uuid,
});
const bundleSchema = z.object({
  releaseId: uuid.nullable(),
  frozen: z.boolean(),
  ready: z.boolean(),
  pages: z.array(z.object({
    pageDocId: uuid,
    pageNo: z.number().int().positive(),
    title: z.string(),
    revisionId: uuid,
    aspect: z.string().nullable().optional(),
    doc: teacherMicrocoursePageDocSchema,
    bindings: z.array(bindingSchema),
  })),
});

export interface PublicClassTeachingPage {
  pageDocId: string;
  pageNo: number;
  title: string;
  revisionId: string;
  aspect: string;
  doc: TeacherMicrocoursePageDoc;
  bindings: TeacherMicrocourseBinding[];
  bindingUrls: ResolvedBindingUrls;
}

export interface PublicClassTeachingCourseware {
  releaseId: string | null;
  frozen: boolean;
  ready: boolean;
  pages: PublicClassTeachingPage[];
}

/**
 * Candidate and live presentation share one exact server read model. Before
 * class it follows the current draft/release; after start it reads the frozen
 * segment snapshot, so refreshing the live page cannot silently switch pages.
 */
export async function getPublicClassTeachingCourseware(
  segmentId: string,
): Promise<PublicClassTeachingCourseware> {
  const parsedId = uuid.parse(segmentId);
  const supabase = await createClient();
  const { data, error } = await rpc(supabase)("get_public_class_teaching_bundle", {
    p_segment_id: parsedId,
  });
  if (error) throw new Error(error.message);
  const bundle = bundleSchema.parse(data);
  const pages = bundle.pages.map((page): Omit<PublicClassTeachingPage, "bindingUrls"> => ({
    ...page,
    aspect: page.aspect ?? "4:3",
    bindings: page.bindings.map((binding) => ({
      ...binding,
      role: null,
      kind: null,
      storagePath: null,
    })),
  }));
  const bindingUrls = await resolveTeacherMicrocoursePageBindingUrls(pages);
  return {
    releaseId: bundle.releaseId,
    frozen: bundle.frozen,
    ready: bundle.ready,
    pages: pages.map((page) => ({
      ...page,
      bindingUrls: bindingUrls.get(page.pageDocId) ?? {},
    })),
  };
}
