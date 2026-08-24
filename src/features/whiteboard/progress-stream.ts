import type { ProgressChunk, StrokeItem } from "./types";

interface PendingStream {
  stroke: StrokeItem;
  nextSeq: number;
  buffered: Map<number, ProgressChunk>;
  legacyFingerprints: Set<string>;
}

function legacyFingerprint(chunk: ProgressChunk): string {
  const first = chunk.points[0];
  const last = chunk.points[chunk.points.length - 1];
  return `${chunk.points.length}:${first?.join(",") ?? ""}:${last?.join(",") ?? ""}`;
}

/** Deduplicates T0/T2 progress and prevents a late chunk from reviving a final stroke. */
export class ProgressStreamAssembler {
  private readonly streams = new Map<string, PendingStream>();
  private readonly finalIds = new Set<string>();
  private readonly finalOrder: string[] = [];

  ingest(chunk: ProgressChunk, committed: boolean): boolean {
    if (!chunk?.id) return false;
    if (chunk.done || committed) {
      return this.finish(chunk.id);
    }
    if (this.finalIds.has(chunk.id)) return false;

    const stream = this.streams.get(chunk.id) ?? {
      stroke: {
        id: chunk.id,
        mode: chunk.mode,
        color: chunk.color,
        wNorm: chunk.wNorm,
        points: [],
      },
      nextSeq: 0,
      buffered: new Map<number, ProgressChunk>(),
      legacyFingerprints: new Set<string>(),
    };
    this.streams.set(chunk.id, stream);

    if (typeof chunk.seq !== "number" || !Number.isSafeInteger(chunk.seq) || chunk.seq < 0) {
      const fingerprint = legacyFingerprint(chunk);
      if (stream.legacyFingerprints.has(fingerprint)) return false;
      stream.legacyFingerprints.add(fingerprint);
      stream.stroke.points.push(...chunk.points);
      return chunk.points.length > 0;
    }

    if (chunk.seq < stream.nextSeq || stream.buffered.has(chunk.seq)) return false;
    stream.buffered.set(chunk.seq, chunk);
    let changed = false;
    while (stream.buffered.has(stream.nextSeq)) {
      const next = stream.buffered.get(stream.nextSeq)!;
      stream.buffered.delete(stream.nextSeq);
      stream.stroke.points.push(...next.points);
      stream.nextSeq += 1;
      changed ||= next.points.length > 0;
    }
    return changed;
  }

  finish(id: string): boolean {
    const removed = this.streams.delete(id);
    if (!this.finalIds.has(id)) {
      this.finalIds.add(id);
      this.finalOrder.push(id);
      if (this.finalOrder.length > 1000) {
        this.finalIds.delete(this.finalOrder.shift()!);
      }
    }
    return removed;
  }

  strokes(): Iterable<StrokeItem> {
    return Array.from(this.streams.values(), (stream) => stream.stroke);
  }
}
