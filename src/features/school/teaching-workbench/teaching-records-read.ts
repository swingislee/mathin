import "server-only";
import { createClient } from "@/lib/supabase/server";
import { teachingContactPage, teachingRecordsSchema, TEACHING_CONTACT_PAGE_SIZE } from "./teaching-records-contract";

export async function getTeachingRecords(sessionId: string, contactPage: number, pageSize: 10 | 20 = 20) {
  const supabase = await createClient();
  const storagePage = Math.floor(((contactPage - 1) * pageSize) / TEACHING_CONTACT_PAGE_SIZE) + 1;
  const { data, error } = await supabase.rpc("get_teaching_session_records", { p_session_id: sessionId, p_contact_page: storagePage });
  if (error) throw new Error(error.message);
  return teachingContactPage(teachingRecordsSchema.parse(data), contactPage, pageSize);
}
