import { beforeEach, expect, it, vi } from "vitest";
import { getActivity, listActivities } from "@/features/school/activities";

const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: mocks.from }) }));

beforeEach(() => vi.resetAllMocks());

function setup(count: number, fail = false) {
  const ids = Array.from({ length: count }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
  const calls: string[][] = [];
  mocks.from.mockImplementation((relation: string) => {
    let selected: string[] = [];
    const query = {
      select: () => query, is: () => query, order: () => query, neq: () => query,
      in: (_column: string, values: string[]) => { selected = values; calls.push(values); return query; },
      returns: async () => {
        if (relation === "business_activities") return { data: [{ id: "activity", activity_registrations: ids.map(id => ({ id, student_id: id, students: { name: id, grade: 3 } })) }], error: null };
        // Model the gateway limit with realistic UUIDs, independent of batch count.
        if (encodeURI(selected.join(",")).length > 7000) throw new Error("URI too long");
        if (fail && selected.includes(ids.at(-1)!)) return { data: null, error: { message: "read failed" } };
        return { data: selected.map(id => ({ id: `${relation}-${id}`, activity_registration_id: id })), error: null };
      },
    };
    return query;
  });
  return { ids, calls };
}

it("loads all assessment and route associations beyond the gateway URI limit", async () => {
  const { ids, calls } = setup(1205);
  const [activity] = await listActivities();
  expect(activity.registrations).toHaveLength(ids.length);
  for (const registration of activity.registrations) {
    expect(registration.assessment?.id).toBe(`business_assessment_results-${registration.id}`);
    expect(registration.route?.id).toBe(`activity_routes-${registration.id}`);
  }
  expect(calls.flat()).toHaveLength(ids.length * 2);
});

it("skips associated queries when there are no registrations", async () => {
  const { calls } = setup(0);
  expect((await listActivities())[0].registrations).toEqual([]);
  expect(calls).toEqual([]);
});

it("surfaces a later batch failure instead of returning incomplete facts", async () => {
  setup(205, true);
  await expect(listActivities()).rejects.toThrow("read failed");
});

it("excludes one-to-one assessments from the directory while keeping individual assessment reads", async () => {
  const source = [
    { id: 'trial', kind: 'trial_class', record_state: 'current', activity_registrations: [] },
    { id: 'assessment', kind: 'assessment_1v1', record_state: 'current', activity_registrations: [] },
    { id: 'past-assessment', kind: 'assessment_1v1', record_state: 'historical', activity_registrations: [] },
  ];
  mocks.from.mockImplementation(() => {
    let rows = source;
    const query = {
      select: () => query, is: () => query, order: () => query,
      neq: (column: string, value: string) => { rows = rows.filter(row => row[column as keyof typeof row] !== value); return query; },
      eq: (column: string, value: string) => { rows = rows.filter(row => row[column as keyof typeof row] === value); return query; },
      returns: async () => ({ data: rows, error: null }),
    };
    return query;
  });
  expect((await listActivities()).map(row => row.id)).toEqual(['trial']);
  expect((await getActivity('assessment'))?.id).toBe('assessment');
});
