import { AuthForm } from "@/components/auth/AuthForm";
import { AuthEntryStatus } from "@/components/auth/AuthEntryStatus";
import { authEntryState } from "@/lib/server/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export default async function SignupEmailPage() {
  const state = await authEntryState();
  if (state === "active") redirect("/app");
  if (state !== "anonymous") return <AuthEntryStatus status={state} path="/signup/email" />;
  return <AuthForm mode="signup" />;
}
