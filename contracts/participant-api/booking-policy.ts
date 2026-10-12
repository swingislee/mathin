export type AssessmentMode = "campus" | "online";
export interface BookingPolicy {
  windowDays: number;
  modes: AssessmentMode[];
  bookingCutoffMinutes: number;
  selfCancellation: boolean;
  cancellationCutoffMinutes: number;
  instructions: { zh: string; en: string };
}
export function defaultBookingPolicy(): BookingPolicy {
  return { windowDays: 14, modes: ["campus"], bookingCutoffMinutes: 0, selfCancellation: false,
    cancellationCutoffMinutes: 0, instructions: { zh: "", en: "" } };
}
