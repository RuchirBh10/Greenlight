import type { UserRole } from "@/types/contract";
import type { Review } from "../types";

/** Who has to do something next. One place, so the menu badge, the dashboard and the queue always agree. */
export const reviewerCanDecide = (r: Review, userId: string) =>
  r.status === "In review" && !r.openEscalation && (!r.assignee || r.assignee.id === userId);
export const needsRouting = (r: Review) => r.status === "In review" && !r.assignee && !r.openEscalation;
export const escalatedTo = (r: Review, role: UserRole) => r.openEscalation?.to_role === role;

/** The number on the Approvals menu item: things waiting on this person. */
export function approvalsBadge(reviews: Review[], role: UserRole | undefined, userId: string | undefined): number {
  if (!role || !userId) return 0;
  if (role === "reviewer") return reviews.filter(r => reviewerCanDecide(r, userId)).length;
  if (role === "manager") return reviews.filter(r => needsRouting(r) || escalatedTo(r, "manager")).length;
  if (role === "brand_admin") return reviews.filter(r => escalatedTo(r, "brand_admin")).length;
  return 0;
}
