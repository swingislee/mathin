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
