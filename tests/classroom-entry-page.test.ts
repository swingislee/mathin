import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  classroom: vi.fn(), workItems: vi.fn(), staff: vi.fn(), readiness: vi.fn(), rooms: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/i18n/navigation", () => ({ Link: "a", useRouter: vi.fn(), usePathname: vi.fn() }));
vi.mock("next-intl/server", () => ({
  setRequestLocale: vi.fn(), getTranslations: async () => (key: string) => key,
}));
vi.mock("@/lib/auth", () => ({
  requireDashboardEnvironment: async () => ({ user: { id: "teacher" }, environment: "staff" }),
  getMyPerms: async () => new Set(),
}));
vi.mock("@/features/school/classes", async (original) => ({
  ...await original<typeof import("@/features/school/classes")>(),
  getClassroomDetailForScope: mocks.classroom, listStaffOptions: mocks.staff,
  getClassroomTeachingReadiness: mocks.readiness,
}));
vi.mock("@/features/school/work-items", () => ({ listMyWorkItems: mocks.workItems }));
vi.mock("@/features/school/organization-locations", () => ({
  getOrganizationTimezoneV2: async () => "Asia/Shanghai",
  getScheduleDefaultsV2: async () => ({ defaultDurationMinutes: 90 }),
  listActiveRoomOptionsV2: mocks.rooms,
}));

const { default: ClassDetailPage } = await import("@/app/[locale]/dashboard/classes/[classId]/page");

function hrefs(node: ReactNode): string[] {
  if (Array.isArray(node)) return node.flatMap(hrefs);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [
    ...(typeof node.props.href === "string" ? [node.props.href] : []),
    ...Object.values(node.props).flatMap((value) => hrefs(value as ReactNode)),
  ];
}

describe("classroom entry critical content", () => {
  it("returns the classroom and live entry while work items and management settings remain pending", async () => {
    const classId = "11111111-1111-4111-8111-111111111111";
    const sessionId = "22222222-2222-4222-8222-222222222222";
    const pending = new Promise(() => {});
    for (const load of [mocks.workItems, mocks.staff, mocks.readiness, mocks.rooms]) load.mockReturnValue(pending);
    mocks.classroom.mockResolvedValue({
      id: classId, name: "Class", courseTitle: "Course", grade: 3,
      primaryTeacherName: "Teacher", learningSupportNames: [], staffAssignments: [], roster: [],
      operationalStatus: "active", offeringType: "long_term_formal", coursewareTrack: "native-16x9",
      capabilities: { canManageClassroom: true, canPrepareTeaching: true, canViewClassroom: true },
      sessions: [{ id: sessionId, state: "scheduled", scheduledAt: "2026-09-09T01:00:00Z", capabilities: { canEnterLive: true } }],
    });
    const page = await ClassDetailPage({ params: Promise.resolve({ locale: "zh", classId }), searchParams: Promise.resolve({}) });
    const suspense = page.props.children;
    const content = suspense.props.children as ReactElement<Record<string, unknown>, (props: Record<string, unknown>) => Promise<ReactNode>>;
    const shell = await content.type(content.props);
    expect(hrefs(shell)).toContain(`/classroom/${classId}/session/${sessionId}/live`);
    expect(mocks.workItems).not.toHaveBeenCalled();
    expect(mocks.staff).not.toHaveBeenCalled();
    expect(mocks.readiness).not.toHaveBeenCalled();
    expect(mocks.rooms).not.toHaveBeenCalled();
  });
});
