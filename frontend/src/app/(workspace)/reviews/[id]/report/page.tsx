import type { Metadata } from "next";
import { DecisionReportView } from "@/features/reviews/components/decision-report";

export const metadata: Metadata = { title: "Decision report" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DecisionReportView id={id} />;
}
