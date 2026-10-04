import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { indexedDB } from "fake-indexeddb";

const FIXTURE_VERSION = "mathin-classroom-m0-baseline-v1";
const STROKE_COUNT = 500;
const BURST_COUNT = 50;
const STROKES_PER_BURST = STROKE_COUNT / BURST_COUNT;
const DURATION_MINUTES = 60;
const SNAPSHOT_WARNING_BYTES = 768 * 1024;
const SNAPSHOT_HARD_LIMIT_BYTES = 1024 * 1024;
const EVENT_READ_LIMIT = 5000;
const POINT_CASES = [16, 32, 64];
const REPLAY_RUNS = 40;
const SYNTHETIC_IDS = Object.freeze({
  sessionId: "fixture-session-m0",
  userId: "fixture-teacher-m0",
  deviceId: "fixture-device-m0",
});

function bytes(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function percentile(values, percentileValue) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(percentileValue * sorted.length) - 1));
  return sorted[index];
}

function roundedMilliseconds(value) {
  return Number(value.toFixed(3));
}

function createStroke(index, averagePoints) {
  const pointScale = [0.5, 0.75, 1, 1, 1.25, 1.5][index % 6];
  const pointCount = Math.max(2, Math.round(averagePoints * pointScale));
  const column = index % 25;
  const row = Math.floor(index / 25);
  const startX = 72 + column * 41 + (index % 3) * 0.37;
  const startY = 54 + (row % 20) * 29 + (index % 5) * 0.23;
  const points = Array.from({ length: pointCount }, (_, pointIndex) => {
    const xCss = startX + pointIndex * 2.7 + Math.sin((index + pointIndex) * 0.31) * 4.8;
    const yCss = startY + Math.cos((index * 0.19) + pointIndex * 0.42) * 8.2 + pointIndex * 0.34;
    return [xCss / 1280, yCss / 720];
  });
  return {
    id: `fixture-stroke-${String(index + 1).padStart(4, "0")}`,
    mode: index % 19 === 0 ? "erase" : "ink",
    color: ["ink", "rose", "blue", "leaf", "crater", "cheek", "moon"][index % 7],
    wNorm: [0.003, 0.006, 0.012][index % 3],
    points,
  };
}

function createSnapshotEvent(items, sequence, minute) {
  return {
    id: `fixture-event-${String(sequence).padStart(4, "0")}`,
    ...SYNTHETIC_IDS,
    seq: sequence,
    type: "board_snapshot",
    payload: { pageKey: "side", items: [...items] },
    at: new Date(Date.UTC(2026, 7, 24, 1, minute, 0)).toISOString(),
  };
}

export function createSixtyMinuteFixture(averagePoints) {
  assert(Number.isInteger(averagePoints) && averagePoints >= 2, "averagePoints must be an integer >= 2");
  const strokes = Array.from({ length: STROKE_COUNT }, (_, index) => createStroke(index, averagePoints));
  const events = [];
  for (let burst = 0; burst < BURST_COUNT; burst += 1) {
    const through = (burst + 1) * STROKES_PER_BURST;
    events.push(createSnapshotEvent(strokes.slice(0, through), burst + 1, Math.floor(((burst + 1) / BURST_COUNT) * (DURATION_MINUTES - 1))));
  }
  return { strokes, events };
}

function openFixtureDatabase(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore("outbox");
      store.createIndex("sessionId", "sessionId", { unique: false });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("fixture IDB open failed"));
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("fixture IDB request failed"));
  });
}

async function idbRoundTrip(events, caseLabel) {
  const db = await openFixtureDatabase(`mathin-m0-${caseLabel}-${Date.now()}-${Math.random()}`);
  const writeStarted = performance.now();
  for (const event of events) {
    await requestResult(db.transaction("outbox", "readwrite").objectStore("outbox").put(event, event.id));
  }
  const writeMs = performance.now() - writeStarted;
  const readStarted = performance.now();
  const restored = await requestResult(
    db.transaction("outbox", "readonly").objectStore("outbox").index("sessionId").getAll(SYNTHETIC_IDS.sessionId),
  );
  const readMs = performance.now() - readStarted;
  db.close();
  assert.equal(restored.length, events.length, "IDB recovery must return every snapshot event");
  assert.equal(restored.at(-1)?.payload?.items?.length, STROKE_COUNT, "IDB recovery must retain the final stroke");
  return { writeMs: roundedMilliseconds(writeMs), readMs: roundedMilliseconds(readMs) };
}

function replayBaseline(serializedEvents) {
  const parseSamples = [];
  const reduceSamples = [];
  for (let run = 0; run < REPLAY_RUNS; run += 1) {
    const parseStarted = performance.now();
    const events = JSON.parse(serializedEvents);
    parseSamples.push(performance.now() - parseStarted);
    const reduceStarted = performance.now();
    let latest = [];
    for (const event of events) {
      if (event.type === "board_snapshot" && event.payload.pageKey === "side") latest = event.payload.items;
    }
    reduceSamples.push(performance.now() - reduceStarted);
    assert.equal(latest.length, STROKE_COUNT, "replay must retain the final stroke");
  }
  return {
    parseP50Ms: roundedMilliseconds(percentile(parseSamples, 0.5)),
    parseP95Ms: roundedMilliseconds(percentile(parseSamples, 0.95)),
    reduceP50Ms: roundedMilliseconds(percentile(reduceSamples, 0.5)),
    reduceP95Ms: roundedMilliseconds(percentile(reduceSamples, 0.95)),
  };
}

export async function measureCase(averagePoints) {
  const { strokes, events } = createSixtyMinuteFixture(averagePoints);
  const finalPayload = events.at(-1).payload;
  const serializedEvents = JSON.stringify(events);
  const finalPayloadBytes = bytes(finalPayload);
  const finalEventBytes = bytes(events.at(-1));
  const cumulativeEventBytes = Buffer.byteLength(serializedEvents, "utf8");
  const totalPoints = strokes.reduce((sum, stroke) => sum + stroke.points.length, 0);
  const idb = await idbRoundTrip(events, `p${averagePoints}`);
  return {
    averagePointsRequested: averagePoints,
    totalPoints,
    actualMeanPointsPerStroke: Number((totalPoints / STROKE_COUNT).toFixed(2)),
    finalPayloadBytes,
    finalPayloadKiB: Number((finalPayloadBytes / 1024).toFixed(2)),
    finalEventBytes,
    cumulativeSnapshotHistoryBytes: cumulativeEventBytes,
    cumulativeSnapshotHistoryMiB: Number((cumulativeEventBytes / 1024 / 1024).toFixed(2)),
    snapshotWarningHeadroomBytes: SNAPSHOT_WARNING_BYTES - finalPayloadBytes,
    snapshotHardLimitHeadroomBytes: SNAPSHOT_HARD_LIMIT_BYTES - finalPayloadBytes,
    status: finalPayloadBytes > SNAPSHOT_HARD_LIMIT_BYTES
      ? "over-hard-limit"
      : finalPayloadBytes > SNAPSHOT_WARNING_BYTES
        ? "over-warning"
        : "within-warning",
    eventReadLimitHeadroom: EVENT_READ_LIMIT - events.length,
    idb,
    replay: replayBaseline(serializedEvents),
  };
}

export function projectCanvasPixels({ width, height, dpr }) {
  const chromeAndControls = Math.max(132, Math.round(height * 0.17));
  const workspaceHeight = Math.max(1, height - chromeAndControls);
  const rightWidth = Math.max(320, Math.round(width * (width <= 1100 ? 0.37 : 0.29)));
  const mainAvailableWidth = Math.max(1, width - rightWidth - 36);
  const mainHeight = Math.min(workspaceHeight, mainAvailableWidth * 0.75);
  const mainWidth = mainHeight * (4 / 3);
  const sideWidth = rightWidth;
  const sideHeight = Math.max(96, Math.round(workspaceHeight * 0.28));
  const mainCanvasPixels = Math.round(mainWidth * mainHeight * dpr * dpr);
  const sideCanvasPixels = Math.round(sideWidth * sideHeight * dpr * dpr);
  return {
    viewport: `${width}x${height}`,
    dpr,
    mainCss: `${Math.round(mainWidth)}x${Math.round(mainHeight)}`,
    sideCss: `${Math.round(sideWidth)}x${Math.round(sideHeight)}`,
    maxBackingPixels: Math.max(mainCanvasPixels, sideCanvasPixels),
    totalBackingPixelsForBaseAndDraft: 2 * (mainCanvasPixels + sideCanvasPixels),
  };
}

async function main() {
  const cases = [];
  for (const pointCase of POINT_CASES) cases.push(await measureCase(pointCase));
  const result = {
    fixtureVersion: FIXTURE_VERSION,
    generatedAt: new Date().toISOString(),
    scope: {
      durationMinutes: DURATION_MINUTES,
      strokes: STROKE_COUNT,
      bursts: BURST_COUNT,
      snapshots: BURST_COUNT,
      boardKey: "side",
      note: "Synthetic no-PII sensitivity baseline; real classroom hardware and observed point density remain required for M0 exit.",
    },
    budgets: {
      snapshotWarningBytes: SNAPSHOT_WARNING_BYTES,
      snapshotHardLimitBytes: SNAPSHOT_HARD_LIMIT_BYTES,
      eventReadLimit: EVENT_READ_LIMIT,
      startingMaxDpr: 1.5,
      startingPerCanvasPixels: 8_000_000,
      startingTotalCanvasPixels: 24_000_000,
    },
    cases,
    canvasPixelProjections: [
      projectCanvasPixels({ width: 1024, height: 768, dpr: 1.5 }),
      projectCanvasPixels({ width: 1280, height: 720, dpr: 1.5 }),
      projectCanvasPixels({ width: 1366, height: 768, dpr: 1.5 }),
      projectCanvasPixels({ width: 1920, height: 1080, dpr: 1.5 }),
    ],
  };
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
