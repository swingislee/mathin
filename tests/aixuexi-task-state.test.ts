import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { readTaskState, resumeSourceLocalization, runTaskStage } from "../scripts/lib/aixuexi-task-state.mjs";
import { parseTaskArgs } from "../scripts/aixuexi-import-task.mjs";
const roots: string[] = [];
afterEach(async () => { for (const dir of roots.splice(0)) await rm(dir, { recursive: true, force: true }); });
it("resumes failed stages while preserving completed work", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mathin-task-")); roots.push(root);
  const file = path.join(root, "state.json");
  let state = await readTaskState(file, "input");
  await runTaskStage(file, state, "catalog", async () => ({ count: 58 }));
  await expect(runTaskStage(file, state, "localize", async () => { throw new Error("missing input"); })).rejects.toThrow("missing input");
  state = await readTaskState(file, "input");
  expect(state.stages.catalog.status).toBe("complete");
  expect(state.stages.localize.status).toBe("failed");
  expect(await runTaskStage(file, state, "catalog", async () => { throw new Error("should reuse"); })).toEqual({ count: 58 });
  await runTaskStage(file, state, "localize", async () => ({ complete: true }));
  expect((await readTaskState(file, "input")).stages.localize.status).toBe("complete");
  await expect(readTaskState(file, "different-input")).rejects.toThrow("STATE_MISMATCH");
});
it("defaults to local development and keeps production promotion separate", () => {
  expect(parseTaskArgs(["--input", ".tmp/hars"]).target).toBe("development");
  expect(() => parseTaskArgs(["--input", ".tmp/hars", "--target", "production"])).toThrow("TARGET");
  expect(() => parseTaskArgs(["--input"])).toThrow("ARGUMENT");
});
function sourceFailure(nextStage: string, ownerLane = "local_pipeline") {
  return Object.assign(new Error("source stage incomplete"), { sourceFailure: { details: { summary: {
    results: [{ lessonId: "1", nextStage, queueStatus: "ready" }], blockers: [{ ownerLane }],
  } } } });
}
it("continues local stages when the source queue advances", async () => {
  let attempts = 0;
  expect(await resumeSourceLocalization(async () => {
    attempts++;
    if (attempts === 1) throw sourceFailure("ordinary_resources");
    if (attempts === 2) throw sourceFailure("offline_verification");
    return "complete";
  })).toBe("complete");
  expect(attempts).toBe(3);
});
it("stops on unchanged failure or a need for additional authorized input", async () => {
  let attempts = 0;
  await expect(resumeSourceLocalization(async () => { attempts++; throw sourceFailure("offline_verification"); })).rejects.toThrow("incomplete");
  expect(attempts).toBe(2);
  attempts = 0;
  await expect(resumeSourceLocalization(async () => { attempts++; throw sourceFailure("local_videos", "company_network"); })).rejects.toThrow("incomplete");
  expect(attempts).toBe(1);
});
