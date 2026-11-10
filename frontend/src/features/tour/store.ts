"use client";
import { isDemo } from "@/lib/api";
import { createPersistentStore } from "@/lib/persistent-store";

export type TourStep = "submit" | "evidence" | "resolve" | "audit" | "approve" | "kit" | "insights";
export const TOUR_STEPS = 7;
type TourState = { done: Partial<Record<TourStep, true>>; open: boolean };

const initial = (): TourState => ({ done: {}, open: true });
export const tourStore = createPersistentStore<TourState>("greenlight-tour-v1", initial, initial());

/** Called from the places where a step really happens, so the checklist reflects what the visitor actually did. Demo only. */
export function markTour(step: TourStep) {
  if (!isDemo()) return;
  const cur = tourStore.read();
  if (!cur.done[step]) tourStore.write({ ...cur, done: { ...cur.done, [step]: true } });
}
export const resetTour = () => tourStore.write(initial());
export const setTourOpen = (open: boolean) => tourStore.write({ ...tourStore.read(), open });
