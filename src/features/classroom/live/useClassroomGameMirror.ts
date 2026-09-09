"use client";

import { useState } from "react";
import type { GameMirrorState } from "@/features/games/types";

/** 控制设备只应用其他设备的镜像，保留本地游戏操作后的反馈和撤销状态。 */
export function useClassroomGameMirror(
  mirror: GameMirrorState | null,
  isController: boolean,
  synchronize: boolean,
  onMirror: (mirror: GameMirrorState) => void,
) {
  const [initial] = useState(mirror);
  const [appliedRemote, setAppliedRemote] = useState(mirror);
  const [localMirrors, setLocalMirrors] = useState<readonly GameMirrorState[]>([]);
  const remote = localMirrors.some((local) => local === mirror) ? appliedRemote : mirror;
  if (synchronize && remote !== appliedRemote) setAppliedRemote(remote);
  return {
    mirror: isController ? synchronize ? remote : initial : mirror,
    publish(next: GameMirrorState) {
      if (synchronize) setLocalMirrors((previous) => [...previous.slice(-31), next]);
      onMirror(next);
    },
  };
}
