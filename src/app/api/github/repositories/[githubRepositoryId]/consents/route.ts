import type { NextRequest } from "next/server";
import { BffError, boundedJson, failed, guard, noStore } from "@/lib/server/auth";
import { consentInput, consentStatusOf, jwt, project, revocationOf, safeRepositoryId } from "@/lib/server/github";
import { privateEnabled } from "@/lib/server/repoq";

type Context = { params: Promise<{ githubRepositoryId: string }> };
export async function GET(request: NextRequest, { params }: Context) {
  try {
    if (new URL(request.url).search) return noStore({ code: "invalid_request" }, 400);
    const id = safeRepositoryId((await params).githubRepositoryId);
    const { token } = await jwt();
    return noStore(consentStatusOf(await project(`/api/github/repositories/${id}/consents`, token, "GET"), id));
  } catch (error) { return failed(error); }
}

export async function PUT(request: NextRequest, { params }: Context) {
  try {
    await guard(request);
    if (new URL(request.url).search) return noStore({ code: "invalid_request" }, 400);
    const id = safeRepositoryId((await params).githubRepositoryId);
    const body = consentInput(await boundedJson(request, 2048));
    const { token } = await jwt();
    const path = `/api/github/repositories/${id}/consents`;
    const current = consentStatusOf(await project(path, token, "GET"), id);
    for (const consent of body.consents) {
      const previous = current.consents.find(item => item.purpose === consent.purpose)!;
      if (consent.decision === "REVOKED") {
        if (previous.decision !== "GRANTED" && previous.decision !== "REVOKED") throw new BffError(403, "consent_not_owned");
        continue;
      }
      if (consent.decision === previous.decision && consent.policyVersion === previous.policyVersion) continue;
      if (!current.consentSubmissionAvailable || consent.policyVersion !== current.currentPolicyVersion)
        throw new BffError(409, "consent_policy_unavailable");
      if (consent.decision === "GRANTED") {
        if (!privateEnabled()) throw new BffError(400, "private_repository_not_supported");
        if (previous.decision === "REVOKED" && previous.cleanupState !== "NO_DERIVED_DATA")
          throw new BffError(409, "revocation_in_progress");
      }
    }
    const result = await project(path, token, "PUT", body, "200_OR_202");
    const status = result.__httpStatus as 200 | 202;
    return noStore(revocationOf(result, status), status);
  } catch (error) { return failed(error); }
}
