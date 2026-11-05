import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { authPost, BffError, digest, origin, sessionHandle } from "./auth";

const cookieName = process.env.NODE_ENV === "production" ? "__Host-DF_GITHUB_ATTEMPT" : "DF_GITHUB_ATTEMPT_DEV";
const proofPattern = /^[A-Za-z0-9_-]{43}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const repositoryId = /^[1-9][0-9]{0,18}$/;
type Kind = "AUTHORIZE_USER" | "INSTALL_APP";
type Status = { userAuthorization: "NOT_AUTHORIZED" | "AUTHORIZED" | "REAUTHORIZE" | "DISCONNECTED"; installation: "NOT_INSTALLED" | "PENDING_APPROVAL" | "INSTALLED"; connectionId: string | null };
export function safeRepositoryId(value: string) { if (!repositoryId.test(value)) throw new BffError(400, "invalid_request"); return value; }
export function safeConnectionId(value: string) { if (!uuid.test(value)) throw new BffError(400, "invalid_request"); return value.toLowerCase(); }

function secret() {
  const value = process.env.WEB_CSRF_SECRET;
  if (!value || value.length < 32) throw new BffError(503, "web_configuration_error");
  return value;
}
function mac(payload: string) { return createHmac("sha256", secret()).update(`github-attempt|${origin()}|${payload}`).digest("base64url"); }
function unavailable(): never { throw new BffError(503, "project_unavailable"); }

export async function jwt() {
  const handle = await sessionHandle();
  if (!handle) throw new BffError(401, "invalid_session");
  const result = await authPost("/internal/auth/session-token", undefined, handle);
  if (result.status !== 200 || typeof result.data.accessToken !== "string" || !result.data.accessToken || result.data.tokenType !== "Bearer" ||
      typeof result.data.expiresAt !== "string" || !Number.isFinite(Date.parse(result.data.expiresAt)))
    throw new BffError(503, "auth_unavailable");
  return { handle, token: result.data.accessToken };
}

export async function project(path: string, token: string, method: "GET" | "POST" | "PUT" | "DELETE", body?: object, expected: 200 | 202 | "200_OR_202" = 200) {
  const configured = process.env.PROJECT_INTERNAL_URL;
  let target: URL;
  try {
    const allowed = method === "GET" && (path === "/api/github/connections" || /^\/api\/github\/repositories\?page=(?:[1-9][0-9]{0,3}|10000)&perPage=30$/.test(path) || /^\/api\/github\/repositories\/[1-9][0-9]{0,18}\/consents$/.test(path)) ||
      method === "POST" && ["/api/github/connections/start", "/api/github/connections/callback/complete", "/api/github/connections/setup/complete"].includes(path) ||
      method === "PUT" && /^\/api\/github\/repositories\/[1-9][0-9]{0,18}\/consents$/.test(path) ||
      method === "DELETE" && /^\/api\/github\/connections\/[0-9a-f-]{36}$/i.test(path);
    if (!configured || !allowed) throw new Error();
    const base = new URL(configured);
    if (!/^https?:$/.test(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== "/") throw new Error();
    target = new URL(path, base);
    if (target.origin !== base.origin) throw new Error();
  } catch { throw new BffError(503, "web_configuration_error"); }
  let response: Response;
  try { response = await fetch(target, { method, body: body ? JSON.stringify(body) : undefined,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(5000) }); }
  catch { return unavailable(); }
  if (response.status >= 300 && response.status < 400) return unavailable();
  const length = Number(response.headers.get("content-length") ?? 0);
  if (!Number.isFinite(length) || length > 131072) return unavailable();
  let data: unknown;
  try {
    const reader = response.body?.getReader(); if (!reader) throw new Error();
    const parts: Uint8Array[] = []; let size = 0;
    while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 131072) { await reader.cancel(); throw new Error(); } parts.push(part.value); }
    data = JSON.parse(Buffer.concat(parts).toString("utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error();
  } catch { return unavailable(); }
  const record = data as Record<string, unknown>;
  if (!response.ok) {
    const code = record.code;
    const allowed: Record<string, number[]> = {
      invalid_request: [400], invalid_token: [401], invalid_session: [401], account_unavailable: [403],
      repository_not_found: [404], connection_not_found: [404], consent_not_owned: [403],
      revocation_required: [409], revocation_in_progress: [409],
      github_attempt_invalid: [403], github_account_conflict: [409], github_identity_mismatch: [403],
      github_access_denied: [403], github_installation_unavailable: [403], github_reauthorization_required: [401],
      github_rate_limited: [503, 429], github_unavailable: [503], github_pagination_limit: [503],
      github_configuration_unavailable: [503], github_credential_unavailable: [503], github_key_version_unavailable: [503],
    };
    if (typeof code !== "string" || !allowed[code]?.includes(response.status)) return unavailable();
    throw new BffError(response.status, code);
  }
  if (response.status !== expected && !(expected === "200_OR_202" && [200, 202].includes(response.status))) return unavailable();
  if (expected === "200_OR_202") return { ...record, __httpStatus: response.status };
  return record;
}

export function statusOf(value: Record<string, unknown>): Status {
  if (!["NOT_AUTHORIZED", "AUTHORIZED", "REAUTHORIZE", "DISCONNECTED"].includes(String(value.userAuthorization)) ||
      !["NOT_INSTALLED", "PENDING_APPROVAL", "INSTALLED"].includes(String(value.installation)) ||
      !(value.connectionId === null || typeof value.connectionId === "string" && uuid.test(value.connectionId))) return unavailable();
  return { userAuthorization: value.userAuthorization, installation: value.installation, connectionId: value.connectionId } as Status;
}

export function consentStatusOf(value: Record<string, unknown>, id: string) {
  if (value.githubRepositoryId !== id || !(value.currentPolicyVersion === null || typeof value.currentPolicyVersion === "string" && value.currentPolicyVersion.length > 0 && value.currentPolicyVersion.length <= 100) ||
      typeof value.consentSubmissionAvailable !== "boolean" || value.consentSubmissionAvailable !== (value.currentPolicyVersion !== null) ||
      !Array.isArray(value.consents) || value.consents.length !== 2) return unavailable();
  const seen = new Set<string>();
  const consents = value.consents.map(raw => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return unavailable();
    const c = raw as Record<string, unknown>;
    if (!["PRIVATE_COLLECTION", "EXTERNAL_AI"].includes(String(c.purpose)) || seen.has(String(c.purpose)) ||
        !(c.decision === null && c.policyVersion === null && c.cleanupState === null ||
          ["GRANTED", "DENIED"].includes(String(c.decision)) && typeof c.policyVersion === "string" && !!c.policyVersion && c.cleanupState === null ||
          c.decision === "REVOKED" && typeof c.policyVersion === "string" && !!c.policyVersion &&
          typeof c.cleanupState === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(c.cleanupState))) return unavailable();
    seen.add(c.purpose as string);
    return { purpose: c.purpose as "PRIVATE_COLLECTION" | "EXTERNAL_AI", decision: c.decision as "GRANTED" | "DENIED" | "REVOKED" | null,
      policyVersion: c.policyVersion as string | null, cleanupState: c.cleanupState as string | null };
  });
  if (seen.size !== 2) return unavailable();
  return { githubRepositoryId: id, currentPolicyVersion: value.currentPolicyVersion as string | null, consentSubmissionAvailable: value.consentSubmissionAvailable, consents };
}

export function consentInput(value: Record<string, unknown>) {
  if (Object.keys(value).some(k => k !== "consents") || !Array.isArray(value.consents) || ![1, 2].includes(value.consents.length)) throw new BffError(400, "invalid_request");
  const seen = new Set<string>();
  const consents = value.consents.map(raw => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new BffError(400, "invalid_request");
    const c = raw as Record<string, unknown>;
    if (Object.keys(c).some(k => !["purpose", "decision", "policyVersion"].includes(k)) ||
        !["PRIVATE_COLLECTION", "EXTERNAL_AI"].includes(String(c.purpose)) || seen.has(String(c.purpose)) ||
        !["GRANTED", "DENIED", "REVOKED"].includes(String(c.decision)) ||
        !(c.decision === "REVOKED" && c.policyVersion === null || typeof c.policyVersion === "string" && !!c.policyVersion && c.policyVersion.length <= 100))
      throw new BffError(400, "invalid_request");
    seen.add(c.purpose as string);
    return { purpose: c.purpose, decision: c.decision, policyVersion: c.policyVersion };
  });
  if (consents.length === 1 && consents[0].decision !== "REVOKED") throw new BffError(400, "invalid_request");
  return { consents };
}

export function revocationOf(value: Record<string, unknown>, status: 200 | 202) {
  if (status === 200 && (value.revocationId !== null || value.status !== "UPDATED") ||
      status === 202 && (typeof value.revocationId !== "string" || !uuid.test(value.revocationId) || value.status !== "BLOCKED")) return unavailable();
  return { revocationId: value.revocationId as string | null, status: value.status as string };
}
export function disconnectionOf(value: Record<string, unknown>, id: string) {
  if (value.connectionId !== id || value.status !== "BLOCKED") return unavailable();
  return { connectionId: id, status: "BLOCKED" };
}

export function listingOf(value: Record<string, unknown>) {
  if (!["CONNECTED", "USER_AUTHORIZATION_REQUIRED", "INSTALLATION_REQUIRED", "INSTALLATION_PENDING"].includes(String(value.status)) ||
    !Array.isArray(value.repositories) || !Number.isSafeInteger(value.page) || (value.page as number) < 1 || typeof value.hasNext !== "boolean") return unavailable();
  const repositories = value.repositories.map((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return unavailable();
    const r = item as Record<string, unknown>;
    // Jackson serializes the record component `isPrivate` under this name.
    const visibility = r.isPrivate ?? r.private;
    if (r.isPrivate !== undefined && r.private !== undefined && r.isPrivate !== r.private) return unavailable();
    if (!Number.isSafeInteger(r.id) || (r.id as number) < 1 || typeof r.name !== "string" || typeof r.fullName !== "string" ||
        !/^[^/\s]+\/[^/\s]+$/.test(r.fullName) || r.name !== r.fullName.split("/")[1] || typeof visibility !== "boolean") return unavailable();
    return { id: r.id as number, fullName: r.fullName, name: r.name, private: visibility };
  });
  if (value.status !== "CONNECTED" && (repositories.length || value.hasNext)) return unavailable();
  return { status: value.status as string, repositories, page: value.page as number, hasNext: value.hasNext };
}

export function startOf(value: Record<string, unknown>) {
  const kind = value.nextAction;
  if (kind !== "AUTHORIZE_USER" && kind !== "INSTALL_APP" || typeof value.proof !== "string" || !proofPattern.test(value.proof) ||
      typeof value.expiresAt !== "string" || typeof value.url !== "string") return unavailable();
  const expiry = Date.parse(value.expiresAt);
  if (!Number.isFinite(expiry) || expiry <= Date.now() || expiry > Date.now() + 600_000) return unavailable();
  let url: URL;
  try { url = new URL(value.url); } catch { return unavailable(); }
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.port || url.username || url.password || url.hash) return unavailable();
  if (kind === "AUTHORIZE_USER") {
    if (url.pathname !== "/login/oauth/authorize" || url.searchParams.get("state") !== value.proof ||
      ["client_id", "redirect_uri", "state", "code_challenge", "code_challenge_method"].some(k => url.searchParams.getAll(k).length !== 1) ||
      !url.searchParams.get("client_id") || !/^[A-Za-z0-9_-]+$/.test(url.searchParams.get("client_id") ?? "") ||
      !/^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get("code_challenge") ?? "") || url.searchParams.get("code_challenge_method") !== "S256" ||
      url.searchParams.get("redirect_uri") !== `${origin()}/api/github/connections/callback` ||
      [...url.searchParams.keys()].some(k => !["client_id", "redirect_uri", "state", "code_challenge", "code_challenge_method"].includes(k))) return unavailable();
  } else if (!/^\/apps\/[A-Za-z0-9-]+\/installations\/new$/.test(url.pathname) || url.search) return unavailable();
  return { kind: kind as Kind, proof: value.proof, expiry, url: url.toString() };
}

export async function saveAttempt(attempt: ReturnType<typeof startOf>, handle: string) {
  const payload = Buffer.from(JSON.stringify({ k: attempt.kind, p: attempt.proof, e: attempt.expiry, h: digest(handle) })).toString("base64url");
  (await cookies()).set(cookieName, `${payload}.${mac(payload)}`, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: Math.max(1, Math.ceil((attempt.expiry - Date.now()) / 1000)) });
}
export async function clearAttempt() { (await cookies()).delete(cookieName); }
export async function readAttempt(kind: Kind, handle: string) {
  const raw = (await cookies()).get(cookieName)?.value;
  if (!raw || raw.length > 512) throw new BffError(403, "github_attempt_invalid");
  const [payload, signature, extra] = raw.split(".");
  if (!payload || !signature || extra) throw new BffError(403, "github_attempt_invalid");
  const expected = Buffer.from(mac(payload)); const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new BffError(403, "github_attempt_invalid");
  let value: Record<string, unknown>;
  try { value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch { throw new BffError(403, "github_attempt_invalid"); }
  if (value.k !== kind || typeof value.p !== "string" || !proofPattern.test(value.p) || value.h !== digest(handle) ||
      !Number.isSafeInteger(value.e) || (value.e as number) <= Date.now() || (value.e as number) > Date.now() + 600_000)
    throw new BffError(403, "github_attempt_invalid");
  return value.p;
}
