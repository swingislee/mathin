import { beforeEach, describe, expect, it, vi } from "vitest";
import FollowupsPage from "../src/app/[locale]/dashboard/followups/page";
import EnrollmentsPage from "../src/app/[locale]/dashboard/followups/enrollments/page";

const mocks = vi.hoisted(() => ({ teacher: vi.fn(), permissions: vi.fn(), capability: vi.fn(), board: vi.fn(), history: vi.fn(), redirect: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next-intl/server", () => ({ setRequestLocale: vi.fn(), getTranslations: async () => (key: string) => key, getNow: async () => new Date("2026-09-11T00:00:00Z") }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => ({ id: "teacher-a" }), requireDashboardEnvironment: async () => ({ user: { id: "teacher-a" } }), getMyPerms: mocks.permissions }));
vi.mock("@/features/school/teacher-workspace", () => ({ isTeacherWorkspaceViewer: mocks.teacher }));
vi.mock("@/features/school/TeacherWorkspaceMemory", () => ({ TeacherWorkspaceEntry: () => null }));
vi.mock("@/features/school/enrollment-workflow-data", () => ({ enrollmentWorkflowRpc: mocks.capability, loadEnrollmentPlacementBoard: mocks.board }));
vi.mock("@/features/school/student-business-history-data", () => ({ loadStudentBusinessHistory: mocks.history }));
vi.mock("@/features/school/organization-locations", () => ({ getOrganizationTimezoneV2: async () => "Asia/Shanghai" }));
vi.mock("@/features/school/EnrollmentPlacementWorkbench", () => ({ EnrollmentPlacementWorkbench: () => null }));
vi.mock("@/features/school/dashboard-page", () => ({ DashboardPage: () => null, DashboardEmptyCard: () => null, DashboardCommandState: () => null }));
vi.mock("@/features/school/FollowupCommandPanel", () => ({ FollowupCommandPanel: () => null }));
vi.mock("@/features/school/FollowupTabs", () => ({ FollowupTabs: () => null }));
vi.mock("@/i18n/navigation", () => ({ redirect: mocks.redirect }));
const params = Promise.resolve({ locale: "zh" });
const board = { options: { classrooms: [], courses: [], terms: [] }, members: [], enrollments: [] };

describe("teacher entry and placement access", () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.teacher.mockResolvedValue(true); mocks.capability.mockResolvedValue(false);
    mocks.permissions.mockResolvedValue(new Set(["followup.view", "class.view.mine"])); mocks.board.mockResolvedValue(board);
    mocks.redirect.mockImplementation(() => { throw new Error("REDIRECT"); });
  });

  it("uses the teacher's remembered workbench entry", async () => {
    const page = await FollowupsPage({ params });
    if (!page) throw new Error("Teacher workspace entry did not render");
    expect(page.props.workspace).toBe("followups"); expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("keeps the existing first-contact intake entry for nonteachers", async () => {
    mocks.teacher.mockResolvedValue(false);
    await expect(FollowupsPage({ params })).rejects.toThrow("REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith({ locale: "zh", href: "/dashboard/followups/leads" });
  });

  it("shows an empty placement workspace to a teacher without exposing a board or history", async () => {
    const page = await EnrollmentsPage({ params, searchParams: Promise.resolve({}) });
    expect(page.props.title).toBe("enrollments");
    expect(page.props.children.props.children).toBe("noTeachingClassForPlacement");
    expect(mocks.board).not.toHaveBeenCalled(); expect(mocks.history).not.toHaveBeenCalled(); expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("keeps the original denial for a nonteacher without placement access", async () => {
    mocks.teacher.mockResolvedValue(false);
    await expect(EnrollmentsPage({ params, searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT");
    expect(mocks.board).not.toHaveBeenCalled(); expect(mocks.history).not.toHaveBeenCalled();
  });

  it("loads the existing board when the placement capability is present", async () => {
    mocks.capability.mockResolvedValue(true);
    const page = await EnrollmentsPage({ params, searchParams: Promise.resolve({ term: "requested-term" }) });
    expect(page.props.initialBoard).toBe(board); expect(page.props.initialTermId).toBe("requested-term");
    expect(mocks.board).toHaveBeenCalledOnce(); expect(mocks.teacher).not.toHaveBeenCalled();
    expect(page.props.history).toBeNull(); expect(page.props.canAdd).toBe(false);
  });
});
