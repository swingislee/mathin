"use client";
import { createContext } from "react";
import type { MiniappExperience } from "../../../../contracts/participant-api/miniapp-experience";
export const ExperienceContext = createContext<MiniappExperience | undefined>(undefined);
