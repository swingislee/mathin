"use client";

import { SpatialActionButton } from "../spatial-interaction/SpatialActionButton";
import { SpatialActionIcon } from "../spatial-interaction/SpatialActionIcon";

import { useRef, useState } from "react";
import { GripVertical } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CubeWorkbenchSession } from "./cube-structures-session";
import { cubeOperationLabel, cubeStructuresMessages } from "./cube-structures-messages";
import { SpatialIconButton } from "../spatial-interaction/SpatialWorkbenchControls";

export function CubeRecordingPanel({ locale, session, playing, replacementStep, onStart, onPause, onResume, onStop, onSeek, onPlay, onReplace, onCancelReplace, onDelete, onMove }: {
  readonly locale: "zh" | "en"; readonly session: CubeWorkbenchSession; readonly playing: boolean; readonly replacementStep: number | null;
  readonly onStart: () => void; readonly onPause: () => void; readonly onResume: () => void; readonly onStop: () => void;
  readonly onSeek: (cursor: number | null) => void; readonly onPlay: () => void; readonly onReplace: (index: number) => void;
  readonly onCancelReplace: () => void; readonly onDelete: (index: number) => void; readonly onMove: (from: number, to: number) => void;
}) {
  const m = cubeStructuresMessages(locale);
  const [destination, setDestination] = useState("1");
  const draggedStep = useRef<number | null>(null);
  const operations = session.lesson?.operations ?? [];
  const cursor = session.preview ?? session.lesson?.cursor ?? 0;
  const editable = session.recording !== "recording" && !playing;
  const selectedStep = Math.max(0, Math.min(cursor - 1, operations.length - 1));
  return <div className="space-y-3 text-xs">
    <div className="sticky top-0 z-10 bg-paper pb-2">
      <p className="mb-1.5 text-muted" role="status">{session.recording === "recording" ? m.recordingActive : session.recording === "paused" ? m.recordingPaused : m.recordOff}</p>
      <div className="flex flex-wrap gap-1" role="toolbar" aria-label={m.record}>
        <SpatialActionButton action="record" label={m.recordStart} disabled={session.recording === "recording"} onClick={onStart} iconClassName="fill-rose text-rose" />
        {session.recording === "recording" && <SpatialActionButton action="pause" label={m.recordPause} onClick={onPause} />}
        {session.recording === "paused" && <SpatialActionButton action="play" label={m.recordResume} onClick={onResume} iconClassName="text-rose" />}
        <SpatialActionButton action="stop" label={m.recordStop} disabled={session.recording === "off"} onClick={onStop} />
        <span className="mx-1 border-l border-line" aria-hidden />
        <SpatialActionButton action="firstStep" label={m.initial} disabled={!operations.length} onClick={() => onSeek(0)} />
        <SpatialIconButton label={playing ? m.pause : m.play} disabled={!operations.length || replacementStep !== null} onClick={onPlay}>{playing ? <SpatialActionIcon action="pause" aria-hidden /> : <SpatialActionIcon action="play" aria-hidden />}</SpatialIconButton>
        <SpatialActionButton action="nextStep" label={m.next} disabled={!operations.length || cursor >= operations.length} onClick={() => onSeek(cursor + 1)} />
      </div>
    </div>
    {!operations.length && <p className="leading-5 text-muted">{m.recordEmpty}</p>}
    {session.recording === "paused" && <p className="leading-5 text-muted">{m.pauseNote}</p>}
    {replacementStep !== null && <div className="flex items-start gap-1 border-l-2 border-rose pl-2 leading-5"><p className="flex-1">{replacementStep + 1} · {m.editingStep}</p><SpatialActionButton action="close" label={m.cancelEdit} onClick={onCancelReplace} /></div>}
    {session.preview !== null && replacementStep === null && <div className="flex items-center gap-1 text-muted"><p className="flex-1 leading-5">{m.previewHint}</p><SpatialActionButton action="close" label={m.exitPreview} onClick={() => onSeek(null)} /></div>}
    <ol className="space-y-1" data-cube-operation-timeline>
      {operations.map((operation, index) => <li key={index} draggable={editable} className={cn("rounded border border-transparent", cursor === index + 1 && "border-crater bg-moon/30")}
        onDragStart={(event) => { draggedStep.current = index; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", `cube-step:${index}`); }}
        onDragEnd={() => { draggedStep.current = null; }}
        onDragOver={(event) => { if (draggedStep.current !== null && editable) event.preventDefault(); }}
        onDrop={(event) => { event.preventDefault(); const from = draggedStep.current; draggedStep.current = null; if (editable && from !== null) onMove(from, index); }}>
        <div className="flex items-center gap-1">
          <GripVertical className="size-3.5 shrink-0 text-muted" aria-label={m.dragStep} />
          <Button size="sm" variant="ghost" className="min-h-8 min-w-0 flex-1 justify-start gap-1 px-1 py-1 text-left text-xs" onClick={() => onSeek(index + 1)} aria-current={cursor === index + 1 ? "step" : undefined}>
            <span className="shrink-0 tabular-nums">{index + 1}.</span><span className="whitespace-normal">{cubeOperationLabel(operation, locale, session.lesson?.initial.origin)}</span>
          </Button>
          {"color" in operation && <span className="mr-1 size-2.5 shrink-0 rounded-full" style={{ background: operation.color }} />}
        </div>
        {cursor === index + 1 && <div className="flex justify-end gap-1 pb-1 pr-1">
          <SpatialActionButton action="edit" label={m.editStep} disabled={!editable} onClick={() => onReplace(index)} />
          <SpatialActionButton action="up" label={m.moveStepUp} disabled={!editable || index === 0} onClick={() => onMove(index, index - 1)} />
          <SpatialActionButton action="down" label={m.moveStepDown} disabled={!editable || index === operations.length - 1} onClick={() => onMove(index, index + 1)} />
          <SpatialActionButton action="remove" label={m.deleteStep} disabled={!editable} onClick={() => onDelete(index)} />
        </div>}
      </li>)}
    </ol>
    {operations.length > 1 && <div className="flex items-center gap-2 border-t border-line pt-2">
      <label htmlFor="cube-record-step-destination" className="flex-1">{m.moveTo}</label>
      <Input id="cube-record-step-destination" type="number" min={1} max={operations.length} value={destination} onChange={(event) => setDestination(event.target.value)} className="h-8 w-16 px-2 text-xs" />
      <SpatialActionButton action="confirm" label={m.confirmMove} disabled={!editable || !Number.isInteger(Number(destination)) || Number(destination) < 1 || Number(destination) > operations.length} onClick={() => onMove(selectedStep, Number(destination) - 1)} />
    </div>}
  </div>;
}
