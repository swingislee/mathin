import "server-only";
import { createClient } from "@/lib/supabase/server";
import { teachingContactPage, teachingRecordsSchema, TEACHING_CONTACT_PAGE_SIZE } from "./teaching-records-contract";
import { getSessionCommunications } from "../session-communication-read";

export async function getTeachingRecords(sessionId: string, contactPage: number, pageSize: 10 | 20 = 20) {
  const supabase = await createClient();
  const storagePage = Math.floor(((contactPage - 1) * pageSize) / TEACHING_CONTACT_PAGE_SIZE) + 1;
  const [{ data, error }, homework, sessionCommunications] = await Promise.all([
    supabase.rpc("get_teaching_session_records", { p_session_id: sessionId, p_contact_page: storagePage }),
    supabase.rpc("get_session_assignment_question_workbooks", { p_session_id: sessionId }),
    getSessionCommunications(sessionId),
  ]);
  if (error) throw new Error(error.message);
  if (homework.error) throw new Error(homework.error.message);
  return teachingContactPage(teachingRecordsSchema.parse({ ...(data as object), homework: homework.data, sessionCommunications }), contactPage, pageSize);
}
