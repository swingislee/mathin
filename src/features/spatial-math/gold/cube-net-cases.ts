import { unitSquareNet, type SquareCell } from "../domain";
import { SPATIAL_GOLD_REVIEW_STATUS } from "./contracts";
import { spatialCubeNetGoldCaseSetSchema } from "./cube-net-contracts";

export const CUBE_NET_GOLD_CANONICAL_KEYS = [
  "0,0;0,1;0,2;1,1;2,1;3,1",
  "0,0;0,1;0,2;1,2;1,3;1,4",
  "0,0;0,1;1,1;1,2;1,3;2,1",
  "0,0;0,1;1,1;1,2;1,3;2,2",
  "0,0;0,1;1,1;1,2;1,3;2,3",
  "0,0;0,1;1,1;1,2;2,1;3,1",
  "0,0;0,1;1,1;1,2;2,2;2,3",
  "0,0;0,1;1,1;2,1;2,2;3,1",
  "0,0;0,1;1,1;2,1;3,1;3,2",
  "0,1;1,0;1,1;1,2;1,3;2,1",
  "0,1;1,0;1,1;1,2;1,3;2,2",
] as const;

function cellsFromKey(key: string): SquareCell[] {
  return key.split(";").map((pair) => {
    const [x, y] = pair.split(",").map(Number);
    return { x, y };
  });
}

export const SPATIAL_CUBE_NET_GOLD_CANDIDATES = spatialCubeNetGoldCaseSetSchema.parse(
  CUBE_NET_GOLD_CANONICAL_KEYS.map((key, index) => {
    const ordinal = String(index + 1).padStart(2, "0");
    return {
      id: `cube-net.${ordinal}`,
      reviewStatus: SPATIAL_GOLD_REVIEW_STATUS,
      title: { zh: `正方体展开图 ${ordinal}`, en: `Cube net ${ordinal}` },
      capability: "P4",
      problemFamily: "cube-net",
      termIds: ["nets-of-solids"],
      net: unitSquareNet(cellsFromKey(key)),
      expected: { isCubeNet: true },
    };
  }),
);
