import { Button } from "@/components/ui/button";

/**
 * Separates the drawable video picture from the browser-owned control strip.
 * The bottom 56px stays uncovered so play/seek/volume/fullscreen keep their
 * native pointer semantics; a short tap above it toggles playback and Smart
 * can take over a moving gesture as ink.
 */
export function ClassroomVideoInkSurface({
  label,
  onToggle,
}: {
  label: string;
  onToggle: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={label}
      data-classroom-input="click"
      data-video-smart-surface
      className="absolute inset-x-0 top-0 bottom-14 z-10 rounded-none p-0 hover:bg-transparent focus-visible:ring-inset"
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    />
  );
}
