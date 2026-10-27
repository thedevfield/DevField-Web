import { AuthMethodSelect } from "@/components/auth/AuthMethodSelect";
import { authEntryState, providerEnabled } from "@/lib/server/auth";
import { AuthEntryStatus } from "@/components/auth/AuthEntryStatus";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export default async function LoginPage() {
  const state = await authEntryState();
  if (state === "active") redirect("/app");
  if (state !== "anonymous") return <AuthEntryStatus status={state} path="/login" />;
  return <AuthMethodSelect mode="login" enabledProviders={(["google", "kakao", "github"] as const).filter(providerEnabled)} />;
}
