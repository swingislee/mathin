export function formatRoomLocation(
  roomName: string | null,
  campusName: string | null,
  fallback: string,
): string {
  return roomName && campusName ? `${campusName} · ${roomName}` : roomName ?? fallback;
}
