import { BookOpen, CheckCircle2, FileCheck2, Files, LayoutDashboard, LineChart, type LucideIcon } from "lucide-react";
import type { UserRole } from "@/types/contract";

export type NavItem = { name: string; href: string; icon: LucideIcon; badge?: "approvals"; roles?: UserRole[] };

/** One flat list. Each role sees only what it can use, so nobody scans past menu items that are not theirs. */
export const navigation: NavItem[] = [
  { name: "Overview", href: "/dashboard", icon: LayoutDashboard },
  { name: "Reviews", href: "/reviews", icon: FileCheck2 },
  { name: "Approvals", href: "/approvals", icon: CheckCircle2, badge: "approvals", roles: ["reviewer", "manager", "brand_admin"] },
  { name: "Brand Kit", href: "/brand-kit", icon: BookOpen },
  { name: "Insights", href: "/insights", icon: LineChart, roles: ["manager", "brand_admin"] },
  { name: "Audit history", href: "/history", icon: Files, roles: ["manager", "brand_admin"] },
];

export const navFor = (role?: UserRole): NavItem[] => navigation.filter(i => !i.roles || (role && i.roles.includes(role)));
