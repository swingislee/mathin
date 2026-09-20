import { z } from "zod";
import { isBoardColor } from "./board-color";
import type { BoardColor } from "./types";

export const boardColorSchema = z.custom<BoardColor>(isBoardColor);
