import { beforeEach, describe, expect, it, vi } from "vitest";
import { activityOffers } from "../src/features/participant-portal/projection";
import { filterActivityOffers } from "../apps/parent-wechat/miniprogram/lib/activity-catalog";

const mock = vi.hoisted(() => ({ rpc: vi.fn(), authorize: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc: mock.rpc }) }));
vi.mock("../src/lib/supabase/config", () => ({ getSupabaseConfig: () => ({ url: "http://127.0.0.1", key: "test" }) }));
vi.mock("../src/features/parent-portal/server", () => ({
  authorize: mock.authorize,
  PortalError: class extends Error {},
  readJson: (request: Request) => request.json(),
  requireResult: (result: { data: unknown; error: { message: string } | null }) => {
    if (result.error) throw new Error(result.error.message);
    return result.data;
  },
  response: (data: unknown, status = 200) => Response.json(data, { status }),
}));
import { courseGet, coursePost } from "../src/features/parent-portal/course-server";

const target = "7b910001-1111-4111-8111-111111111111";
const requestId = "7b910002-1111-4111-8111-111111111111";
const participantId = "7b910003-1111-4111-8111-111111111111";
const offer = { id: target, kind: "activity" as const, title: "数独运动", description: "四次训练", priceCents: null,
  bookingClosesAt: "2030-10-17T06:00:00Z", revision: 1, classes: [],
  activity: { id: target, tags: ["短期课", "数独运动"], targetGrades: [5, 6], location: "紫辰阁",
    startsAt: "2030-10-17T06:00:00Z", durationMinutes: 90, remaining: 20 } };
const command = { action: "apply", id: requestId, kind: "activity", publicationId: target,
  revision: 1, classroomId: null, participantId };
const post = (value: unknown) => new Request("http://localhost/api/v1/participant/activities", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value),
});

describe("participant short course compatibility", () => {
  beforeEach(() => { vi.clearAllMocks(); mock.authorize.mockResolvedValue({ db: { rpc: mock.rpc } }); });
  it("serves the published short course to both grades through the shipped client contract", async () => {
    mock.rpc.mockResolvedValue({ data: [offer], error: null });
    const response = await courseGet(new Request("http://localhost/api/v1/participant/activities"), "participant");
    const projected = activityOffers(await response.json());
    expect(mock.rpc).toHaveBeenCalledWith("miniapp_participant_activity_catalog");
    expect(filterActivityOffers(projected, "g5", "", 0)).toHaveLength(1);
    expect(filterActivityOffers(projected, "g6", "", 0)).toHaveLength(1);
    expect(filterActivityOffers(projected, "g4", "", 0)).toHaveLength(0);
    expect(projected[0].tags).toContain("短期课");
  });
  it("shows kindergarten offers only for their two stages", () => {
    const projected = activityOffers([{ ...offer, activity: { ...offer.activity, targetGrades: [-1, 0] } }]);
    expect(filterActivityOffers(projected, "k2", "", 0)).toHaveLength(1);
    expect(filterActivityOffers(projected, "k3", "", 0)).toHaveLength(1);
    expect(filterActivityOffers(projected, "g1", "", 0)).toHaveLength(0);
  });
  it("submits through the target-aware RPC after authenticating", async () => {
    mock.rpc.mockResolvedValue({ data: requestId, error: null });
    const response = await coursePost(post(command), "participant");
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: requestId });
    expect(mock.authorize).toHaveBeenCalledOnce();
    expect(mock.rpc).toHaveBeenCalledWith("miniapp_participant_apply_registration", {
      p_id: requestId, p_target_id: target, p_revision: 1, p_student_id: participantId,
    });
  });
  it("keeps parent class submission on the existing contract", async () => {
    mock.rpc.mockResolvedValue({ data: requestId, error: null });
    await coursePost(post({ ...command, kind: "class", classroomId: target }));
    expect(mock.rpc).toHaveBeenCalledWith("miniapp_apply_registration", expect.objectContaining({ p_kind: "class", p_target_id: target }));
    await expect(coursePost(post({ ...command, kind: "class", classroomId: target }), "participant")).rejects.toThrow("VALIDATION");
  });
  it("uses the same participant boundary for history and cancellation", async () => {
    mock.rpc.mockResolvedValueOnce({ data: [], error: null }).mockResolvedValueOnce({ data: null, error: null });
    await courseGet(new Request("http://localhost/api/v1/participant/activities?resource=applications"), "participant");
    await coursePost(post({ action: "cancel", id: requestId }), "participant");
    expect(mock.rpc.mock.calls).toEqual([
      ["miniapp_participant_registration_applications"], ["miniapp_participant_cancel_registration", { p_id: requestId }],
    ]);
  });
});
