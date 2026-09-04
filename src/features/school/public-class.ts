import "server-only";

import { createClient } from "@/lib/supabase/server";
import { listActiveRoomOptionsV2 } from "./organization-locations";
import type { ClassBuildCourseDetail } from "./teaching-operations/course-picker-types";

export const DEFAULT_PUBLIC_CLASS_PRINT_BACKGROUND = "/illustrations/public-class-print-background-v1.png";

export const PUBLIC_CLASS_SEGMENT_KINDS = ["trial_lesson", "group_assessment", "parent_talk"] as const;
export type PublicClassSegmentKind = (typeof PUBLIC_CLASS_SEGMENT_KINDS)[number];
export type PublicClassPresence = "expected" | "attended" | "late" | "absent" | "not_applicable";
export const PUBLIC_CLASS_VIEWS = ["teaching", "onsite", "live", "review"] as const;
export type PublicClassView = (typeof PUBLIC_CLASS_VIEWS)[number];

export interface PublicClassParticipantRecord {
  id: string;
  segmentId: string;
  registrationId: string;
  studentPresence: PublicClassPresence;
  guardianPresence: PublicClassPresence;
  learningObservation: string;
  assessmentSummary: string;
  parentFeedback: string;
  recommendation: string;
  updatedByName: string | null;
  updatedAt: string;
}

export interface PublicClassParticipant {
  registrationId: string;
  studentId: string | null;
  leadId: string | null;
  name: string;
  phone: string;
  grade: number | null;
  gradeText: string;
  identity: "student" | "lead";
  status: "booked" | "attended" | "no_show" | "cancelled";
  outcome: string;
  records: PublicClassParticipantRecord[];
}

export interface PublicClassSegment {
  id: string;
  kind: PublicClassSegmentKind;
  title: string;
  scheduledAt: string;
  durationMin: number;
  roomId: string | null;
  roomName: string | null;
  campusName: string | null;
  location: string;
  position: number;
  primaryTeacherId: string | null;
  primaryTeacherName: string | null;
  assistantTeacherId: string | null;
  assistantTeacherName: string | null;
  microcourseCourseId: string | null;
  microcourseCourseTitle: string | null;
  microcourseLectureId: string | null;
  microcourseLectureTitle: string | null;
  microcourseFamilyId: string | null;
  microcourseId: string | null;
  microcourseAuthorId: string | null;
  teachingStartedAt: string | null;
  teachingEndedAt: string | null;
  teachingCheckpointPageIds: string[];
  printBackgroundPath: string | null;
}

export interface PublicClassClassroomLink {
  classroomId: string;
  classroomName: string;
  candidateRegistrationIds: string[];
}

export interface PublicClassWorkbenchData {
  activity: {
    id: string;
    title: string;
    scheduledAt: string;
    location: string;
    capacity: number | null;
    remark: string;
    printBackgroundPath: string;
  };
  segments: PublicClassSegment[];
  participants: PublicClassParticipant[];
  classroomLinks: PublicClassClassroomLink[];
  classroomOptions: Array<{ id: string; name: string }>;
  roomOptions: Array<{ id: string; name: string; campusName: string; capacity: number | null }>;
  staffOptions: Array<{ id: string; name: string }>;
  microcourseFamilyId: string | null;
  /** Pre-authorized catalog consumed by the same CoursePicker as formal classes. */
  microcourseCatalog: ClassBuildCourseDetail[];
}

export interface LinkedPublicClassSummary {
  activityId: string;
  title: string;
  scheduledAt: string;
  candidateCount: number;
}

interface DbError { message: string }
interface DbResult<T> { data: T | null; error: DbError | null }
interface Query<T> extends PromiseLike<DbResult<T>> {
  select(columns: string): Query<T>;
  eq(column: string, value: unknown): Query<T>;
  in(column: string, values: readonly string[]): Query<T>;
  is(column: string, value: null): Query<T>;
  neq(column: string, value: unknown): Query<T>;
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): Query<T>;
  limit(count: number): Query<T>;
}
type From = <T>(relation: string) => Query<T>;

function from<T>(client: { from: unknown }, relation: string): Query<T> {
  return (client.from as From)<T>(relation);
}

function rows<T>(result: DbResult<T[]>): T[] {
  if (result.error) throw new Error(result.error.message);
  return result.data ?? [];
}

interface ActivityDbRow {
  id: string;
  kind: string;
  title: string;
  scheduled_at: string;
  location: string;
  capacity: number | null;
  remark: string;
  public_class_print_background_path: string | null;
}
interface SegmentDbRow {
  id: string;
  kind: PublicClassSegmentKind;
  title: string;
  scheduled_at: string;
  duration_min: number;
  room_id: string | null;
  location: string;
  position: number;
  primary_teacher_id: string | null;
  assistant_teacher_id: string | null;
  microcourse_course_id: string | null;
  microcourse_lecture_id: string | null;
  microcourse_id: string | null;
  teaching_started_at: string | null;
  teaching_ended_at: string | null;
  print_background_path: string | null;
}
interface RegistrationDbRow {
  id: string;
  student_id: string | null;
  lead_id: string | null;
  status: PublicClassParticipant["status"];
  outcome: string;
}
interface ParticipantRecordDbRow {
  id: string;
  segment_id: string;
  registration_id: string;
  student_presence: PublicClassPresence;
  guardian_presence: PublicClassPresence;
  learning_observation: string;
  assessment_summary: string;
  parent_feedback: string;
  recommendation: string;
  updated_by: string | null;
  updated_at: string;
}
interface StudentDbRow { id: string; name: string; grade: number | null }
interface LeadDbRow {
  id: string;
  provisional_student_name: string;
  phone: string;
  grade_hint: number | null;
  grade_text: string;
}
interface ProfileDbRow { id: string; display_name: string }
interface RoomDbRow { id: string; name: string; capacity: number | null; campus_id: string }
interface CampusDbRow { id: string; name: string }
interface ClassroomDbRow { id: string; name: string }
interface ClassroomLinkDbRow { classroom_id: string }
interface ClassroomParticipantDbRow { classroom_id: string; registration_id: string }
interface TeachingCheckpointDbRow { segment_id: string; page_doc_id: string; position: number }
interface FamilyDbRow { id: string; title: string }
interface CourseDbRow {
  id: string;
  family_id: string;
  title: string;
  product_code: string | null;
  catalog_version_id: string;
  superseded_by_course_id: string | null;
  grade: number;
  term: number | null;
  class_type: string;
  course_kind: "curriculum" | "microcourse";
}
interface CatalogVersionDbRow { id: string; slug: string; title: string }
interface LectureDbRow {
  id: string;
  course_id: string;
  no: number;
  name: string;
  status: string;
  current_release_id: string | null;
}
interface MicrocourseDbRow { id: string; course_id: string; author_id: string }

export async function getPublicClassWorkbench(activityId: string): Promise<PublicClassWorkbenchData | null> {
  const supabase = await createClient();
  const [activityResult, segmentResult, registrationResult, recordResult, linkResult, candidateResult] = await Promise.all([
    from<ActivityDbRow[]>(supabase, "activities")
      .select("id,kind,title,scheduled_at,location,capacity,remark,public_class_print_background_path")
      .eq("id", activityId).is("deleted_at", null).limit(1),
    from<SegmentDbRow[]>(supabase, "public_class_segments")
      .select("id,kind,title,scheduled_at,duration_min,room_id,location,position,primary_teacher_id,assistant_teacher_id,microcourse_course_id,microcourse_lecture_id,microcourse_id,teaching_started_at,teaching_ended_at,print_background_path")
      .eq("activity_id", activityId).order("scheduled_at", { ascending: true }).order("position", { ascending: true }),
    from<RegistrationDbRow[]>(supabase, "activity_registrations")
      .select("id,student_id,lead_id,status,outcome")
      .eq("activity_id", activityId).order("created_at", { ascending: true }),
    from<ParticipantRecordDbRow[]>(supabase, "public_class_participant_records")
      .select("id,segment_id,registration_id,student_presence,guardian_presence,learning_observation,assessment_summary,parent_feedback,recommendation,updated_by,updated_at")
      .eq("activity_id", activityId),
    from<ClassroomLinkDbRow[]>(supabase, "public_class_classroom_links")
      .select("classroom_id").eq("activity_id", activityId),
    from<ClassroomParticipantDbRow[]>(supabase, "public_class_classroom_participants")
      .select("classroom_id,registration_id").eq("activity_id", activityId),
  ]);
  const activities = rows(activityResult);
  const activity = activities[0];
  if (!activity || activity.kind !== "public_class") return null;
  const segmentRows = rows(segmentResult);
  const registrations = rows(registrationResult);
  const recordRows = rows(recordResult);
  const linkRows = rows(linkResult);
  const candidateRows = rows(candidateResult);
  const checkpointResult = segmentRows.length
    ? await from<TeachingCheckpointDbRow[]>(supabase, "public_class_teaching_checkpoints")
      .select("segment_id,page_doc_id,position")
      .in("segment_id", segmentRows.map((segment) => segment.id))
      .order("position", { ascending: true })
    : { data: [], error: null };
  const checkpointRows = rows(checkpointResult);

  const studentIds = registrations.flatMap((item) => item.student_id ? [item.student_id] : []);
  const leadIds = registrations.flatMap((item) => item.lead_id ? [item.lead_id] : []);
  const profileIds = [...new Set(segmentRows.flatMap((item) => [item.primary_teacher_id, item.assistant_teacher_id]).filter((id): id is string => Boolean(id))
    .concat(recordRows.flatMap((item) => item.updated_by ? [item.updated_by] : [])))];
  const roomIds = [...new Set(segmentRows.flatMap((item) => item.room_id ? [item.room_id] : []))];
  const courseIds = [...new Set(segmentRows.flatMap((item) => item.microcourse_course_id ? [item.microcourse_course_id] : []))];
  const lectureIds = [...new Set(segmentRows.flatMap((item) => item.microcourse_lecture_id ? [item.microcourse_lecture_id] : []))];
  const microcourseIds = [...new Set(segmentRows.flatMap((item) => item.microcourse_id ? [item.microcourse_id] : []))];
  const linkedClassroomIds = [...new Set(linkRows.map((item) => item.classroom_id))];

  const [studentResult, leadResult, profileResult, roomResult, linkedClassroomResult, familyResult, allStaffResult, activeRoomOptions, classroomOptionResult] = await Promise.all([
    studentIds.length ? from<StudentDbRow[]>(supabase, "students").select("id,name,grade").in("id", studentIds) : Promise.resolve({ data: [], error: null }),
    leadIds.length ? from<LeadDbRow[]>(supabase, "leads").select("id,provisional_student_name,phone,grade_hint,grade_text").in("id", leadIds) : Promise.resolve({ data: [], error: null }),
    profileIds.length ? from<ProfileDbRow[]>(supabase, "profiles").select("id,display_name").in("id", profileIds) : Promise.resolve({ data: [], error: null }),
    roomIds.length ? from<RoomDbRow[]>(supabase, "campus_rooms").select("id,name,capacity,campus_id").in("id", roomIds) : Promise.resolve({ data: [], error: null }),
    linkedClassroomIds.length ? from<ClassroomDbRow[]>(supabase, "classrooms").select("id,name").in("id", linkedClassroomIds) : Promise.resolve({ data: [], error: null }),
    from<FamilyDbRow[]>(supabase, "course_families").select("id,title").eq("slug", "teacher-microcourses").limit(1),
    from<ProfileDbRow[]>(supabase, "profiles").select("id,display_name").eq("is_active", true).in("role", ["staff", "admin"]).order("display_name", { ascending: true }).limit(300),
    listActiveRoomOptionsV2(),
    from<ClassroomDbRow[]>(supabase, "classrooms").select("id,name").is("archived_at", null).is("trashed_at", null).order("name", { ascending: true }).limit(300),
  ]);
  const students = rows(studentResult);
  const leads = rows(leadResult);
  const profiles = rows(profileResult);
  const currentRooms = rows(roomResult);
  const linkedClassrooms = rows(linkedClassroomResult);
  const families = rows(familyResult);
  const allStaff = rows(allStaffResult);
  const allRooms: RoomDbRow[] = activeRoomOptions.map((room) => ({
    id: room.id,
    name: room.name,
    capacity: room.capacity,
    campus_id: room.campusId,
  }));
  const classroomOptions = rows(classroomOptionResult);
  const microcourseFamilyId = families[0]?.id ?? null;

  const campusIds = [...new Set([...currentRooms, ...allRooms].map((room) => room.campus_id))];
  const [campusResult, selectedCourseResult, selectedLectureResult, selectedMicrocourseResult, microcourseCourseResult] = await Promise.all([
    campusIds.length ? from<CampusDbRow[]>(supabase, "campuses").select("id,name").in("id", campusIds) : Promise.resolve({ data: [], error: null }),
    courseIds.length ? from<CourseDbRow[]>(supabase, "courses").select("id,family_id,title,product_code,catalog_version_id,superseded_by_course_id,grade,term,class_type,course_kind").in("id", courseIds) : Promise.resolve({ data: [], error: null }),
    lectureIds.length ? from<LectureDbRow[]>(supabase, "course_lectures").select("id,course_id,no,name,status,current_release_id").in("id", lectureIds) : Promise.resolve({ data: [], error: null }),
    microcourseIds.length ? from<MicrocourseDbRow[]>(supabase, "teacher_microcourses").select("id,course_id,author_id").in("id", microcourseIds) : Promise.resolve({ data: [], error: null }),
    microcourseFamilyId
      ? from<CourseDbRow[]>(supabase, "courses").select("id,family_id,title,product_code,catalog_version_id,superseded_by_course_id,grade,term,class_type,course_kind").eq("family_id", microcourseFamilyId).eq("course_kind", "microcourse").is("trashed_at", null).order("updated_at", { ascending: false }).limit(200)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const campuses = rows(campusResult);
  const selectedCourses = rows(selectedCourseResult);
  const selectedLectures = rows(selectedLectureResult);
  const selectedMicrocourses = rows(selectedMicrocourseResult);
  const microcourseCourses = rows(microcourseCourseResult);
  const optionCourseIds = microcourseCourses.map((course) => course.id);
  const microcourseLectureResult = optionCourseIds.length
    ? await from<LectureDbRow[]>(supabase, "course_lectures").select("id,course_id,no,name,status,current_release_id")
      .in("course_id", optionCourseIds).neq("status", "archived").order("no", { ascending: true }).limit(1_000)
    : { data: [], error: null };
  const microcourseLectures = rows(microcourseLectureResult);
  const catalogMicrocourseResult = optionCourseIds.length
    ? await from<MicrocourseDbRow[]>(supabase, "teacher_microcourses")
      .select("id,course_id,author_id").in("course_id", optionCourseIds).is("withdrawn_at", null)
    : { data: [], error: null };
  const catalogMicrocourses = rows(catalogMicrocourseResult);
  const versionIds = [...new Set(microcourseCourses.map((course) => course.catalog_version_id))];
  const catalogVersionResult = versionIds.length
    ? await from<CatalogVersionDbRow[]>(supabase, "course_catalog_versions")
      .select("id,slug,title").in("id", versionIds)
    : { data: [], error: null };
  const catalogVersions = rows(catalogVersionResult);

  const studentById = new Map(students.map((item) => [item.id, item]));
  const leadById = new Map(leads.map((item) => [item.id, item]));
  const profileById = new Map([...profiles, ...allStaff].map((item) => [item.id, item.display_name || "—"]));
  const campusById = new Map(campuses.map((item) => [item.id, item.name]));
  const roomById = new Map([...currentRooms, ...allRooms].map((item) => [item.id, item]));
  const classroomById = new Map([...linkedClassrooms, ...classroomOptions].map((item) => [item.id, item.name]));
  const courseById = new Map([...selectedCourses, ...microcourseCourses].map((item) => [item.id, item]));
  const lectureById = new Map([...selectedLectures, ...microcourseLectures].map((item) => [item.id, item]));
  const catalogVersionById = new Map(catalogVersions.map((item) => [item.id, item]));
  const microcourseById = new Map(selectedMicrocourses.map((item) => [item.id, item]));
  const catalogAuthorByCourseId = new Map(catalogMicrocourses.map((item) => [item.course_id, item.author_id]));
  const recordsByRegistration = new Map<string, PublicClassParticipantRecord[]>();
  for (const record of recordRows) {
    const entries = recordsByRegistration.get(record.registration_id) ?? [];
    entries.push({
      id: record.id,
      segmentId: record.segment_id,
      registrationId: record.registration_id,
      studentPresence: record.student_presence,
      guardianPresence: record.guardian_presence,
      learningObservation: record.learning_observation,
      assessmentSummary: record.assessment_summary,
      parentFeedback: record.parent_feedback,
      recommendation: record.recommendation,
      updatedByName: record.updated_by ? profileById.get(record.updated_by) ?? null : null,
      updatedAt: record.updated_at,
    });
    recordsByRegistration.set(record.registration_id, entries);
  }

  return {
    activity: {
      id: activity.id,
      title: activity.title,
      scheduledAt: activity.scheduled_at,
      location: activity.location,
      capacity: activity.capacity,
      remark: activity.remark,
      printBackgroundPath: activity.public_class_print_background_path || DEFAULT_PUBLIC_CLASS_PRINT_BACKGROUND,
    },
    segments: segmentRows.map((segment) => {
      const room = segment.room_id ? roomById.get(segment.room_id) : undefined;
      const course = segment.microcourse_course_id ? courseById.get(segment.microcourse_course_id) : undefined;
      const lecture = segment.microcourse_lecture_id ? lectureById.get(segment.microcourse_lecture_id) : undefined;
      return {
        id: segment.id,
        kind: segment.kind,
        title: segment.title,
        scheduledAt: segment.scheduled_at,
        durationMin: segment.duration_min,
        roomId: segment.room_id,
        roomName: room?.name ?? null,
        campusName: room ? campusById.get(room.campus_id) ?? null : null,
        location: segment.location,
        position: segment.position,
        primaryTeacherId: segment.primary_teacher_id,
        primaryTeacherName: segment.primary_teacher_id ? profileById.get(segment.primary_teacher_id) ?? null : null,
        assistantTeacherId: segment.assistant_teacher_id,
        assistantTeacherName: segment.assistant_teacher_id ? profileById.get(segment.assistant_teacher_id) ?? null : null,
        microcourseCourseId: segment.microcourse_course_id,
        microcourseCourseTitle: course?.title ?? null,
        microcourseLectureId: segment.microcourse_lecture_id,
        microcourseLectureTitle: lecture?.name ?? null,
        microcourseFamilyId: course?.family_id ?? null,
        microcourseId: segment.microcourse_id,
        microcourseAuthorId: segment.microcourse_id ? microcourseById.get(segment.microcourse_id)?.author_id ?? null : null,
        teachingStartedAt: segment.teaching_started_at,
        teachingEndedAt: segment.teaching_ended_at,
        teachingCheckpointPageIds: checkpointRows
          .filter((checkpoint) => checkpoint.segment_id === segment.id)
          .map((checkpoint) => checkpoint.page_doc_id),
        printBackgroundPath: segment.print_background_path,
      };
    }),
    participants: registrations.map((registration) => {
      const student = registration.student_id ? studentById.get(registration.student_id) : undefined;
      const lead = registration.lead_id ? leadById.get(registration.lead_id) : undefined;
      return {
        registrationId: registration.id,
        studentId: registration.student_id,
        leadId: registration.lead_id,
        name: student?.name ?? lead?.provisional_student_name ?? "—",
        phone: lead?.phone ?? "",
        grade: student?.grade ?? lead?.grade_hint ?? null,
        gradeText: lead?.grade_text ?? "",
        identity: student ? "student" : "lead",
        status: registration.status,
        outcome: registration.outcome,
        records: recordsByRegistration.get(registration.id) ?? [],
      };
    }),
    classroomLinks: linkRows.map((link) => ({
      classroomId: link.classroom_id,
      classroomName: classroomById.get(link.classroom_id) ?? "—",
      candidateRegistrationIds: candidateRows.filter((item) => item.classroom_id === link.classroom_id).map((item) => item.registration_id),
    })),
    classroomOptions: classroomOptions.map((item) => ({ id: item.id, name: item.name || "—" })),
    roomOptions: allRooms.map((room) => ({
      id: room.id,
      name: room.name,
      campusName: campusById.get(room.campus_id) ?? "—",
      capacity: room.capacity,
    })),
    staffOptions: allStaff.map((item) => ({ id: item.id, name: item.display_name || "—" })),
    microcourseFamilyId,
    microcourseCatalog: microcourseCourses.map((course) => {
      const lectures = microcourseLectures.filter((lecture) => lecture.course_id === course.id);
      const version = catalogVersionById.get(course.catalog_version_id);
      const authorId = catalogAuthorByCourseId.get(course.id) ?? null;
      return {
        id: course.id,
        familyId: course.family_id,
        familyTitle: families[0]?.title ?? "—",
        title: course.title,
        productCode: course.product_code,
        catalogVersionSlug: version?.slug ?? "default",
        catalogVersionTitle: version?.title ?? "",
        isSuperseded: course.superseded_by_course_id !== null,
        grade: course.grade,
        courseSeason: course.term,
        classType: course.class_type,
        lectureCount: lectures.length,
        releasedLectureCount: lectures.filter((lecture) => lecture.current_release_id !== null).length,
        courseKind: "microcourse",
        authorId,
        authorName: authorId ? profileById.get(authorId) ?? null : null,
        primaryTopicSlug: null,
        primaryTopicTitleZh: null,
        primaryTopicTitleEn: null,
        keywords: [],
        lectures: lectures.map((lecture) => ({
          id: lecture.id,
          no: lecture.no,
          name: lecture.name,
          objectives: "",
          ready: lecture.current_release_id !== null,
        })),
      };
    }),
  };
}

export async function listPublicClassesForClassroom(classroomId: string): Promise<LinkedPublicClassSummary[]> {
  const supabase = await createClient();
  const [linkResult, candidateResult] = await Promise.all([
    from<Array<{ activity_id: string }>>(supabase, "public_class_classroom_links")
      .select("activity_id").eq("classroom_id", classroomId),
    from<Array<{ activity_id: string; registration_id: string }>>(supabase, "public_class_classroom_participants")
      .select("activity_id,registration_id").eq("classroom_id", classroomId),
  ]);
  const links = rows(linkResult);
  const candidates = rows(candidateResult);
  const activityIds = links.map((link) => link.activity_id);
  if (activityIds.length === 0) return [];
  const activityResult = await from<Array<{ id: string; title: string; scheduled_at: string }>>(supabase, "activities")
    .select("id,title,scheduled_at").in("id", activityIds).is("deleted_at", null).order("scheduled_at", { ascending: false });
  return rows(activityResult).map((activity) => ({
    activityId: activity.id,
    title: activity.title,
    scheduledAt: activity.scheduled_at,
    candidateCount: candidates.filter((candidate) => candidate.activity_id === activity.id).length,
  }));
}
