import { EntryExperience } from "@/components/brand/EntryExperience";
import { AuthEntryStatus } from "@/components/auth/AuthEntryStatus";
import { authEntryState } from "@/lib/server/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export default async function Home() {
  const state = await authEntryState();
  if (state === "active") redirect("/app");
  if (state !== "anonymous") return <AuthEntryStatus status={state} path="/" />;
  return <EntryExperience />;
}
