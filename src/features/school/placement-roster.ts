import {
  placementDestinationError,
  type PlacementClassroom,
  type PlacementStudent,
} from "./enrollment-workflow-contract";

/** 保留真实座次；缺号或重复记录按原名单顺序补入空位，仅用于展示。 */
export function placementRosterSeats(
  classroom: PlacementClassroom,
  members: readonly PlacementStudent[],
): Array<{ seat: number; student: PlacementStudent | null }> {
  const occupied = new Map<number, PlacementStudent>();
  const unnumbered: PlacementStudent[] = [];
  for (const student of members) {
    if (student.classroomId !== classroom.id || student.status === "withdrawn") continue;
    if (student.seat !== null && Number.isInteger(student.seat) && student.seat > 0 && !occupied.has(student.seat)) {
      occupied.set(student.seat, student);
    } else {
      unnumbered.push(student);
    }
  }
  let available = 1;
  for (const student of unnumbered) {
    while (occupied.has(available)) available += 1;
    occupied.set(available, student);
    available += 1;
  }
  const lastOccupied = Math.max(0, ...occupied.keys());
  const size = classroom.capacity === null
    ? lastOccupied + 1
    : Math.max(classroom.capacity, lastOccupied);
  return Array.from({ length: size }, (_, index) => ({ seat: index + 1, student: occupied.get(index + 1) ?? null }));
}

/** 落点依照服务端座次校验；展示补位不构成可交换的真实座位。 */
export function placementSeatTargetError(
  student: PlacementStudent,
  classroom: PlacementClassroom | null,
  target: { termId: string; grade: number; seat: number | null },
  members: readonly PlacementStudent[],
): string | null {
  if (student.status === "withdrawn") return "ENROLLMENT_CANCELLED";
  if (student.termId !== target.termId || student.grade !== target.grade) return "CLASS_TARGET_MISMATCH";
  if (!classroom) return target.seat === null ? placementDestinationError(student, null, members) : "INVALID_SEAT";
  if (classroom.termId !== target.termId) return "CLASS_TARGET_MISMATCH";
  if (target.seat === null || !Number.isInteger(target.seat) || target.seat < 1
      || (classroom.capacity !== null && target.seat > classroom.capacity)) return "INVALID_SEAT";
  const destinationError = placementDestinationError(student, classroom, members);
  if (destinationError) return destinationError;

  const classroomMembers = members.filter((member) => member.classroomId === classroom.id && member.status !== "withdrawn");
  const actualOccupants = classroomMembers.filter((member) => member.seat === target.seat);
  const displayedOccupant = placementRosterSeats(classroom, classroomMembers).find((slot) => slot.seat === target.seat)?.student;
  if (actualOccupants.length > 1 || (displayedOccupant && displayedOccupant.seat !== target.seat)) return "PLACEMENT_CHANGED";
  if (student.classroomId === classroom.id && student.seat !== null
      && classroomMembers.filter((member) => member.seat === student.seat).length > 1) return "PLACEMENT_CHANGED";
  if (actualOccupants.length > 0 && student.classroomId !== classroom.id) return "SEAT_OCCUPIED";
  return null;
}
