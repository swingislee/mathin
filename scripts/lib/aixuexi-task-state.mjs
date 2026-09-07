import { readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

export async function resumeSourceLocalization(action, onProgress = () => {}) {
  let previous = null;
  for (let attempt = 0; attempt < 12; attempt++) {
    try { return await action(); }
    catch (error) {
      const summary = error.sourceFailure?.details?.summary;
      if (!summary || !Array.isArray(summary.results) || !Array.isArray(summary.blockers)
          || summary.blockers.some((blocker) => blocker.ownerLane !== "local_pipeline")) throw error;
      const progress = JSON.stringify(summary.results.map(({ lessonId, nextStage, queueStatus }) => ({ lessonId, nextStage, queueStatus })));
      if (progress === previous) throw error;
      previous = progress;
      onProgress();
    }
  }
  throw new Error("AIXUEXI_TASK_SOURCE_PROGRESS_LIMIT");
}

export async function readTaskState(file, inputFingerprint) {
  try {
    const state = JSON.parse(await readFile(file, "utf8"));
    if (state.schemaVersion !== "mathin-aixuexi-task-v1" || state.inputFingerprint !== inputFingerprint) throw new Error("AIXUEXI_TASK_STATE_MISMATCH");
    return state;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { schemaVersion: "mathin-aixuexi-task-v1", inputFingerprint, stages: {} };
  }
}

export async function runTaskStage(stateFile, state, name, action, { refresh = false } = {}) {
  if (!refresh && state.stages[name]?.status === "complete") return state.stages[name].result;
  const save = async () => {
    const temporary = `${stateFile}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(temporary, stateFile);
  };
  state.stages[name] = { status: "running", startedAt: new Date().toISOString() };
  await save();
  process.stderr.write(`AIXUEXI_TASK: ${name}\n`);
  try {
    const result = await action();
    state.stages[name] = { ...state.stages[name], status: "complete", completedAt: new Date().toISOString(), result };
    await save();
    return result;
  } catch (error) {
    state.stages[name] = { ...state.stages[name], status: "failed", error: String(error.message).slice(0, 1000) };
    await save();
    throw error;
  }
}
