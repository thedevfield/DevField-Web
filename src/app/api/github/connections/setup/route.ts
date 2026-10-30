import { BffError, origin } from "@/lib/server/auth";
import { clearAttempt, jwt, project, readAttempt, statusOf } from "@/lib/server/github";

export async function GET(request: Request) {
  let result = "failed";
  try {
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some(k => !["installation_id", "setup_action"].includes(k)) ||
        query.getAll("installation_id").length !== 1 || query.getAll("setup_action").length !== 1) throw new BffError(400, "invalid_request");
    const raw = query.get("installation_id") ?? "", setupAction = query.get("setup_action");
    if (!/^[1-9][0-9]{0,15}$/.test(raw) || !Number.isSafeInteger(Number(raw)) || !["install", "update"].includes(setupAction ?? ""))
      throw new BffError(400, "invalid_request");
    const { handle, token } = await jwt();
    const proof = await readAttempt("INSTALL_APP", handle);
    const status = statusOf(await project("/api/github/connections/setup/complete", token, "POST", { proof, installationId: Number(raw), setupAction }));
    result = status.installation === "INSTALLED" ? "connected" : status.installation === "PENDING_APPROVAL" ? "pending" : "failed";
  } catch (error) {
    if (error instanceof BffError) result = error.code === "github_attempt_invalid" ? "expired" : error.code === "github_installation_unavailable" || error.code === "github_access_denied" ? "denied" : "failed";
  }
  await clearAttempt();
  return new Response(null, { status: 303, headers: { Location: `${origin()}/app/repoq/settings/github?result=${result}`, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
