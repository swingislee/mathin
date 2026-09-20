import "server-only";
import { createClient } from "@/lib/supabase/server";
import { teachingContactPage, teachingRecordsSchema, TEACHING_CONTACT_PAGE_SIZE } from "./teaching-records-contract";
import { getSessionCommunications } from "../session-communication-read";

/** 原教学记录的身份、课次与实际名单合同；摘要读取只取这一份事实。 */
export async function getTeachingSessionRecords(sessionId: string, contactPage = 1) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_teaching_session_records", { p_session_id: sessionId, p_contact_page: contactPage });
  if (error) throw new Error(error.message);
  return teachingRecordsSchema.parse(data);
}

export async function getTeachingRecords(sessionId: string, contactPage: number, pageSize: 10 | 20 = 20) {
  const supabase = await createClient();
  const storagePage = Math.floor(((contactPage - 1) * pageSize) / TEACHING_CONTACT_PAGE_SIZE) + 1;
  const [data, homework, sessionCommunications] = await Promise.all([
    getTeachingSessionRecords(sessionId, storagePage),
    supabase.rpc("get_session_assignment_question_workbooks", { p_session_id: sessionId }),
    getSessionCommunications(sessionId),
  ]);
  if (homework.error) throw new Error(homework.error.message);
  return teachingContactPage(teachingRecordsSchema.parse({ ...data, homework: homework.data, sessionCommunications }), contactPage, pageSize);
}
