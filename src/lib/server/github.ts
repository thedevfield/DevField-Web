import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { authPost, BffError, digest, origin, sessionHandle } from "./auth";

const cookieName = process.env.NODE_ENV === "production" ? "__Host-DF_GITHUB_ATTEMPT" : "DF_GITHUB_ATTEMPT_DEV";
const proofPattern = /^[A-Za-z0-9_-]{43}$/;
type Kind = "AUTHORIZE_USER" | "INSTALL_APP";
type Status = { userAuthorization: "NOT_AUTHORIZED" | "AUTHORIZED" | "REAUTHORIZE"; installation: "NOT_INSTALLED" | "PENDING_APPROVAL" | "INSTALLED" };

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

export async function project(path: string, token: string, method: "GET" | "POST", body?: object) {
  const configured = process.env.PROJECT_INTERNAL_URL;
  let target: URL;
  try {
    if (!configured || !path.startsWith("/api/github/") || path.includes("#")) throw new Error();
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
    if (typeof code !== "string" || !/^github_[a-z_]{1,45}$/.test(code)) return unavailable();
    if ([400, 401, 403, 409, 410, 429, 503].includes(response.status)) throw new BffError(response.status, code);
    return unavailable();
  }
  if (response.status !== 200) return unavailable();
  return record;
}

export function statusOf(value: Record<string, unknown>): Status {
  if (!["NOT_AUTHORIZED", "AUTHORIZED", "REAUTHORIZE"].includes(String(value.userAuthorization)) ||
      !["NOT_INSTALLED", "PENDING_APPROVAL", "INSTALLED"].includes(String(value.installation))) return unavailable();
  return { userAuthorization: value.userAuthorization, installation: value.installation } as Status;
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
