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
    if (!current.consentSubmissionAvailable || body.consents.some(consent => consent.policyVersion !== current.currentPolicyVersion))
      throw new BffError(409, "consent_policy_unavailable");
    if (!privateEnabled() && body.consents.some(consent => consent.decision === "GRANTED" &&
        !current.consents.some(previous => previous.purpose === consent.purpose && previous.decision === "GRANTED" && previous.policyVersion === current.currentPolicyVersion)))
      throw new BffError(400, "private_repository_not_supported");
    const result = await project(path, token, "PUT", body, "200_OR_202");
    const status = result.__httpStatus as 200 | 202;
    return noStore(revocationOf(result, status), status);
  } catch (error) { return failed(error); }
}
