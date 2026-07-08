export type ClassroomRole = "teacher" | "student";

export interface ClassroomMeta {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
  myRole: ClassroomRole;
}

export interface ClassroomMember {
  userId: string;
  displayName: string;
  role: ClassroomRole;
}

export interface ClassroomRecord extends ClassroomMeta {
  members: ClassroomMember[];
  /** 仅教师可见（经 RPC），其余为 null。 */
  inviteCode: string | null;
}

// ---------------------------------------------------------------------------
// 课件页（08-§3.6）：有序页数组存 class_sessions.courseware jsonb。
// image/video 存 Storage 路径（候课时预载为 blob）；
// game 只存 {gameId, difficulty, seed}——题面由 createRng(seed) 确定性推导，零预载天然离线。
// ---------------------------------------------------------------------------

export type CoursewarePage =
  | { id: string; type: "image"; path: string; title: string }
  | { id: string; type: "video"; path: string; title: string }
  | { id: string; type: "game"; gameId: string; difficulty: "easy" | "medium" | "hard"; seed: string; title: string }
  | { id: string; type: "board"; title: string };

export interface ClassSessionMeta {
  id: string;
  classroomId: string;
  title: string;
  pageCount: number;
  currentPage: number;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
}

export interface ClassSessionRecord extends ClassSessionMeta {
  courseware: CoursewarePage[];
}

// ---------------------------------------------------------------------------
// 课堂事件流（08-§3.4）：id 客户端 uuid + (deviceId, seq) 幂等；
// 排序靠单写者天然有序，不依赖时钟。
// ---------------------------------------------------------------------------

export type SessionEventType =
  | "page"           // {page:number} 教师翻页
  | "star"           // {studentId} 教师加星
  | "star_undo"      // {studentId, eventId} 撤销该生最新一颗星（原子语义：指名事件）
  | "session_ctl"    // {action:"start"|"end"}
  | "board_snapshot" // {pageKey:number, items:[...]}（P4-5）
  | "game_state"     // {pageId, state}（P4-5 游戏页镜像）
  | "hand"           // 学生举手（P4-5）
  | "answer";        // 学生作答（P4-5）

export interface SessionEvent {
  id: string;
  sessionId: string;
  userId: string;
  deviceId: string;
  seq: number;
  type: SessionEventType;
  payload: Record<string, unknown>;
  /** 客户端时间 ISO 串，报告展示用；排序不依赖它。 */
  at: string;
}
