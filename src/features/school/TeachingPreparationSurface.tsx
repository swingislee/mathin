import type { ReactNode } from "react";
import { SessionPrepSplit } from "./SessionPrepSplit";

/**
 * Shared preparation canvas for every teaching occurrence.
 *
 * A formal session and a public-class segment keep different persistence
 * adapters, but the teacher should work in one stable two-pane surface: the
 * preparation flow on the left and the resident courseware on the right.
 */
export function TeachingPreparationSurface({
  notice,
  flow,
  courseware,
}: {
  notice?: ReactNode;
  flow: ReactNode;
  courseware: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-3 px-1" data-shared-teaching-preparation-surface>
      {notice}
      <SessionPrepSplit flow={flow} courseware={courseware} />
    </div>
  );
}
