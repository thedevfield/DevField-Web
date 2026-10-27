import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";

const publicOrigin = process.env.WEB_PUBLIC_ORIGIN ?? (process.env.NODE_ENV === "production" ? "" : "http://localhost:13000");
const authOrigin = process.env.AUTH_INTERNAL_URL ?? "http://127.0.0.1:18080";
const sessionName = process.env.NODE_ENV === "production" ? "__Host-DF_WEB_SESSION" : "DF_WEB_SESSION_DEV";
const csrfName = process.env.NODE_ENV === "production" ? "__Host-DF_CSRF" : "DF_CSRF_DEV";
const secure = process.env.NODE_ENV === "production";

export class BffError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

export function noStore<T>(body: T, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}

export function failed(error: unknown) {
  const e = error instanceof BffError ? error : new BffError(503, "auth_unavailable");
  return noStore({ code: e.code }, e.status);
}

export function origin() {
  if (!publicOrigin || !/^https?:\/\/[^/]+$/.test(publicOrigin)) throw new BffError(503, "web_configuration_error");
  if (process.env.NODE_ENV === "production" && !publicOrigin.startsWith("https://"))
    throw new BffError(503, "web_configuration_error");
  return publicOrigin;
}

export function providerEnabled(provider: string) {
  return ["google", "github", "kakao"].includes(provider) &&
    (process.env.WEB_ENABLED_OAUTH_PROVIDERS ?? "").split(",").map(x => x.trim()).includes(provider);
}

function csrfSecret() {
  const value = process.env.WEB_CSRF_SECRET;
  if (!value || value.length < 32) throw new BffError(503, "web_configuration_error");
  return value;
}

function digest(value: string) { return createHash("sha256").update(value).digest("hex"); }
export { digest };
export function nonce() { return randomBytes(32).toString("base64url"); }

function signCsrf(seed: string, expires: number, handle: string | undefined) {
  return createHmac("sha256", csrfSecret()).update(`${seed}|${expires}|${origin()}|${handle ? digest(handle) : "anonymous"}`).digest("base64url");
}

export async function sessionHandle() { return (await cookies()).get(sessionName)?.value; }

export async function csrfIssue() {
  const jar = await cookies();
  const existing = jar.get(csrfName)?.value;
  const seed = existing && /^[A-Za-z0-9_-]{43}$/.test(existing) ? existing : nonce();
  const expires = Date.now() + 20 * 60_000;
  jar.set(csrfName, seed, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 1200 });
  return `${expires}.${signCsrf(seed, expires, jar.get(sessionName)?.value)}`;
}

export async function csrfRotate() {
  const jar = await cookies();
  jar.delete(csrfName);
}

export async function guard(request: NextRequest) {
  const expected = origin();
  if (request.headers.get("origin") !== expected) throw new BffError(403, "invalid_origin");
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") throw new BffError(403, "invalid_origin");
  const token = request.headers.get("x-devfield-csrf") ?? "";
  const [rawExpiry, provided, extra] = token.split(".");
  const expiry = Number(rawExpiry);
  const jar = await cookies();
  const seed = jar.get(csrfName)?.value;
  if (extra || !seed || !Number.isSafeInteger(expiry) || expiry < Date.now() || expiry > Date.now() + 20 * 60_000 || !provided)
    throw new BffError(403, "invalid_csrf");
  const actual = Buffer.from(provided);
  const wanted = Buffer.from(signCsrf(seed, expiry, jar.get(sessionName)?.value));
  if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) throw new BffError(403, "invalid_csrf");
}

export async function boundedJson(request: Request, maxBytes = 8192): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new BffError(415, "invalid_content_type");
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new BffError(413, "request_too_large");
  const reader = request.body?.getReader();
  if (!reader) throw new BffError(400, "invalid_request");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new BffError(413, "request_too_large"); }
    chunks.push(value);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || Array.isArray(value) || typeof value !== "object") throw new Error();
    return value;
  } catch { throw new BffError(400, "invalid_request"); }
}

export function stringField(body: Record<string, unknown>, key: string, max: number) {
  const value = body[key];
  if (typeof value !== "string" || value.length > max) throw new BffError(400, "invalid_request");
  return value;
}

export async function authPost(path: string, body?: object, handle?: string): Promise<{ status: number; data: Record<string, unknown> }> {
  const key = process.env.DEVFIELD_BFF_SERVICE_KEY;
  if (!key || !origin()) throw new BffError(503, "web_configuration_error");
  let target: URL;
  try {
    if (!path.startsWith("/") || path.startsWith("//") || path.includes("?") || path.includes("#")) throw new Error();
    target = new URL(path, authOrigin);
    if (!/^https?:$/.test(target.protocol) || target.origin !== new URL(authOrigin).origin) throw new Error();
  }
  catch { throw new BffError(503, "web_configuration_error"); }
  let response: Response;
  try {
    response = await fetch(target, {
      method: "POST", cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(5000),
      headers: { "Content-Type": "application/json", "X-DevField-Service": "bff", "X-DevField-Service-Key": key,
        ...(handle ? { "X-DevField-Session-Handle": handle } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch { throw new BffError(503, "auth_unavailable"); }
  if (response.status === 204) return { status: 204, data: {} };
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > 16_384) throw new BffError(503, "auth_unavailable");
  let data: Record<string, unknown> = {};
  try {
    const reader = response.body?.getReader();
    if (!reader) throw new Error();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16_384) { await reader.cancel(); throw new Error(); }
      chunks.push(value);
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    data = raw ? JSON.parse(raw) : {};
    if (!data || Array.isArray(data) || typeof data !== "object") throw new Error();
  } catch { throw new BffError(503, "auth_unavailable"); }
  if (response.ok) return { status: response.status, data };
  if ([400, 409, 410, 429, 503].includes(response.status) && typeof data.code === "string" && /^[a-z_]{1,50}$/.test(data.code))
    throw new BffError(response.status, data.code);
  if (response.status === 401) throw new BffError(401, "invalid_session");
  if (response.status === 403) throw new BffError(403, "session_unavailable");
  throw new BffError(503, "auth_unavailable");
}

export async function requireSession() {
  const handle = await sessionHandle();
  if (!handle) throw new BffError(401, "invalid_session");
  try { await authPost("/internal/auth/session-token", undefined, handle); return handle; }
  catch (error) { if (error instanceof BffError && [401, 403].includes(error.status)) throw error; throw new BffError(503, "auth_unavailable"); }
}

export async function authEntryState(): Promise<"active" | "anonymous" | "forbidden" | "unavailable"> {
  try { await requireSession(); return "active"; }
  catch (error) {
    if (error instanceof BffError && error.status === 401) return "anonymous";
    if (error instanceof BffError && error.status === 403) return "forbidden";
    return "unavailable";
  }
}

export async function setSession(handle: string) {
  (await cookies()).set(sessionName, handle, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 86400 });
  await csrfRotate();
}

export async function clearSession() {
  const jar = await cookies();
  jar.delete(sessionName);
  jar.delete(csrfName);
}
