import type { Metadata } from "next";
import { KeysView } from "./keys-view";

export const metadata: Metadata = { title: "API keys" };

export default function KeysPage() {
  return <KeysView />;
}
