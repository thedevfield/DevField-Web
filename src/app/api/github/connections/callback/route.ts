import { BffError, origin } from "@/lib/server/auth";
import { clearAttempt, jwt, project, readAttempt, statusOf } from "@/lib/server/github";

export async function GET(request: Request) {
  let result = "failed";
  let stage = "QUERY_VALIDATION";
  try {
    const query = new URL(request.url).searchParams;
    const issuers = query.getAll("iss");
    if (issuers.length > 1 || (issuers.length === 1 && issuers[0] !== "https://github.com/login/oauth"))
      throw new BffError(400, "invalid_issuer");
    if (query.has("error")) {
      result = query.get("error") === "access_denied" ? "cancelled" : "failed";
    } else {
      const code = query.get("code"), state = query.get("state");
      if ([...query.keys()].some(k => !["code", "state", "iss"].includes(k)) || query.getAll("code").length !== 1 || query.getAll("state").length !== 1 ||
          !code || code.length > 512 || !state || !/^[A-Za-z0-9_-]{43}$/.test(state)) throw new BffError(400, "invalid_request");
      stage = "SESSION_TOKEN";
      const { handle, token } = await jwt();
      stage = "ATTEMPT_COOKIE";
      const proof = await readAttempt("AUTHORIZE_USER", handle);
      stage = "STATE_MATCH";
      if (state !== proof) throw new BffError(403, "github_attempt_invalid");
      stage = "PROJECT_COMPLETE";
      const status = statusOf(await project("/api/github/connections/callback/complete", token, "POST", { code, proof }));
      result = status.userAuthorization === "AUTHORIZED" ? "authorized" : "failed";
    }
  } catch (error) {
    console.warn("GitHub App callback failed", { stage, code: error instanceof BffError ? error.code : "unexpected_error" });
    if (error instanceof BffError) result = error.code === "github_attempt_invalid" ? "expired" : error.code === "github_account_conflict" ? "conflict" : "failed";
  }
  await clearAttempt();
  return new Response(null, { status: 303, headers: { Location: `${origin()}/app/repoq?result=${result}`, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
