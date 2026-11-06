import type { Metadata } from "next";
import { AnomaliesView } from "./anomalies-view";

export const metadata: Metadata = { title: "Anomalies" };

export default function AnomaliesPage() {
  return <AnomaliesView />;
}
