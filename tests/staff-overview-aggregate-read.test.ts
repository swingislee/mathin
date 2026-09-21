import { beforeEach, expect, it, vi } from "vitest";
import { readStaffOverviewAcquisitionContacts } from "@/features/school/home/staff-overview-aggregate-read";
import { overviewAcquisitionContactSummarySchema } from "@/features/school/home/staff-overview-aggregate-contract";

const state = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: state.rpc }) }));
vi.mock("@/features/school/organization-locations", () => ({ getOrganizationTimezoneV2: async () => "Asia/Shanghai" }));
const unavailable = { available: false, missingDates: 3, comparison: null, people: [] };
const available = { available: true, missingDates: 0, comparison: { current: 0, previous: 0, trend: [] }, people: [] };
beforeEach(() => {
  state.rpc.mockReset();
  state.rpc.mockResolvedValue({ error: null, data: { schemaVersion: 2, metrics: { leads: unavailable, contacts: available } } });
});

it("reads summaries once and preserves complete previous month and partial weekly cutoffs", async () => {
  const now = new Date("2026-09-21T04:12:37.123Z");
  const month = await readStaffOverviewAcquisitionContacts({ grain: "month", now });
  expect(state.rpc).toHaveBeenCalledTimes(1);
  expect(state.rpc.mock.calls[0][1].p_window).toMatchObject({ currentStart: "2026-08-31T16:00:00.000Z", previousCutoff: "2026-08-31T16:00:00.000Z" });
  expect(month.metrics.leads).toEqual(unavailable);
  expect(month.metrics.contacts.comparison?.current).toBe(0);
  await readStaffOverviewAcquisitionContacts({ grain: "week", now });
  expect(state.rpc.mock.calls[1][1].p_window.previousCutoff).toBe("2026-09-14T04:12:00.000Z");
});

it("keeps unavailable metrics distinct from zero and refuses inconsistent responses", () => {
  expect(overviewAcquisitionContactSummarySchema.safeParse({ schemaVersion: 2, metrics: { leads: unavailable, contacts: available } }).success).toBe(true);
  for (const bad of [{ ...unavailable, comparison: available.comparison }, { ...available, comparison: null }, { ...available, missingDates: -1 }]) {
    expect(overviewAcquisitionContactSummarySchema.safeParse({ schemaVersion: 2, metrics: { leads: bad, contacts: available } }).success).toBe(false);
  }
});

it("reports a missing migration or invalid response without falling back to full-table reads", async () => {
  state.rpc.mockResolvedValueOnce({ error: { code: "PGRST202" }, data: null });
  await expect(readStaffOverviewAcquisitionContacts({ grain: "month" })).rejects.toThrow("OVERVIEW_AGGREGATE_UNAVAILABLE");
  state.rpc.mockResolvedValueOnce({ error: null, data: { records: [] } });
  await expect(readStaffOverviewAcquisitionContacts({ grain: "month" })).rejects.toThrow("OVERVIEW_AGGREGATE_INVALID_RESULT");
});
