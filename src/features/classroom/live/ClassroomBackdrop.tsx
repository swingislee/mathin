import type { CSSProperties } from "react";
import {
  resolveClassroomBackdrop,
  type ClassroomBackdropSelection,
} from "./classroom-backdrops";

type BackdropStyle = CSSProperties & {
  [name: `--scene-${string}`]: string | undefined;
};

export function ClassroomBackdrop({
  selection,
}: {
  selection?: ClassroomBackdropSelection;
}) {
  const resolved = resolveClassroomBackdrop(selection);
  const { backdrop } = resolved;
  const style: BackdropStyle = {
    "--scene-art-day": `url("${backdrop.dayAsset}")`,
    "--scene-art-night": `url("${backdrop.nightAsset}")`,
    "--scene-bg-day": backdrop.dayBackground,
    "--scene-bg-night": backdrop.nightBackground,
    "--scene-wash-day": backdrop.dayWash,
    "--scene-wash-night": backdrop.nightWash,
  };

  return (
    <div
      aria-hidden="true"
      className="scene-day scene-adaptive pointer-events-none absolute inset-0 -z-10 overflow-hidden"
      data-classroom-backdrop={backdrop.id}
      data-classroom-backdrop-scope={resolved.scope}
      data-classroom-backdrop-fallback={resolved.fellBack ? "true" : "false"}
      style={style}
    >
      <div
        className="scene-illustration"
        style={{ backgroundPosition: backdrop.backgroundPosition }}
      />
      <div className="scene-illustration-wash" />
      <div className="absolute inset-0 bg-paper/20" />
    </div>
  );
}
