import "server-only";
import { BffError } from "./auth";
import { jwt } from "./github";
import type { AnalysisSnapshot, ClaimType } from "../repoq-analysis";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const publicUrl = /^https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9_.-]{1,100})\/?$/;
const repositoryId = /^[1-9][0-9]{0,18}$/;
export const privateEnabled = () => process.env.WEB_PRIVATE_REGISTRATION_ENABLED === "true";
const statuses = new Set(["QUEUED", "RUNNING", "FAILED", "INSUFFICIENT_EVIDENCE", "CANCELLED", "READY"]);
const errors: Record<string, number[]> = {
  invalid_request: [400], invalid_name: [400], invalid_repository_url: [400], invalid_repositories: [400], repository_unavailable: [400],
  repository_already_registered: [409], last_repository_required: [409], analysis_in_progress: [409], idempotency_key_conflict: [409],
  project_not_found: [404], repository_not_found: [404], invalid_session: [401], invalid_token: [401],
  account_unavailable: [403], auth_unavailable: [503], github_unavailable: [503], github_rate_limited: [503],
  project_unavailable: [503], private_repository_not_supported: [400], private_collection_consent_required: [403],
  revocation_in_progress: [409], revocation_required: [409],
  private_access_unavailable: [403], github_access_denied: [403], github_pagination_limit: [503], github_reauthorization_required: [401],
};

export function projectId(value: string) {
  if (!uuid.test(value)) throw new BffError(400, "invalid_request");
  return value.toLowerCase();
}
export function requestKey(value: string | null) {
  if (!value || value.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(value)) throw new BffError(400, "invalid_request");
  return value;
}
export function repositoriesInput(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) throw new BffError(400, "invalid_repositories");
  const seen = new Set<string>();
  return value.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new BffError(400, "invalid_request");
    const entry = item as Record<string, unknown>;
    if (entry.githubRepositoryId !== undefined) {
      if (!privateEnabled()) throw new BffError(400, "private_repository_not_supported");
      if (Object.keys(entry).some(k => !["githubRepositoryId", "consents", "visibility"].includes(k)) ||
          typeof entry.githubRepositoryId !== "string" || !repositoryId.test(entry.githubRepositoryId) ||
          entry.visibility !== undefined && entry.visibility !== "PRIVATE" || !Array.isArray(entry.consents) || entry.consents.length !== 2)
        throw new BffError(400, "invalid_request");
      const purposes = new Set<string>();
      const consents = entry.consents.map(raw => {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new BffError(400, "invalid_request");
        const c = raw as Record<string, unknown>;
        if (Object.keys(c).some(k => !["purpose", "decision", "policyVersion"].includes(k)) ||
            !["PRIVATE_COLLECTION", "EXTERNAL_AI"].includes(String(c.purpose)) || purposes.has(String(c.purpose)) ||
            !["GRANTED", "DENIED"].includes(String(c.decision)) || typeof c.policyVersion !== "string" || !c.policyVersion || c.policyVersion.length > 100)
          throw new BffError(400, "invalid_request");
        purposes.add(c.purpose as string);
        return { purpose: c.purpose, decision: c.decision, policyVersion: c.policyVersion };
      });
      if (!purposes.has("PRIVATE_COLLECTION") || !purposes.has("EXTERNAL_AI")) throw new BffError(400, "invalid_request");
      if (!consents.some(c => c.purpose === "PRIVATE_COLLECTION" && c.decision === "GRANTED")) throw new BffError(403, "private_collection_consent_required");
      const identity = `id:${entry.githubRepositoryId}`;
      if (seen.has(identity)) throw new BffError(409, "repository_already_registered");
      seen.add(identity);
      return { githubRepositoryId: entry.githubRepositoryId, consents };
    }
    if (Object.keys(entry).some(k => k !== "repositoryUrl")) throw new BffError(400, "invalid_request");
    const raw = entry.repositoryUrl;
    if (typeof raw !== "string" || raw.length > 300) throw new BffError(400, "invalid_repository_url");
    const url = raw.trim();
    const match = publicUrl.exec(url);
    if (!match || match[2] === "." || match[2] === ".." || match[2].endsWith(".git")) throw new BffError(400, "invalid_repository_url");
    const canonical = `https://github.com/${match[1]}/${match[2]}`;
    const identity = `url:${canonical.toLowerCase()}`;
    if (seen.has(identity)) throw new BffError(409, "repository_already_registered");
    seen.add(identity);
    return { repositoryUrl: canonical };
  });
}
export function createInput(value: Record<string, unknown>) {
  if (Object.keys(value).some(k => !["name", "repositories"].includes(k))) throw new BffError(400, "invalid_request");
  if (typeof value.name !== "string" || !value.name.trim() || value.name.trim().length > 100) throw new BffError(400, "invalid_name");
  return { name: value.name.trim(), repositories: repositoriesInput(value.repositories) };
}
export function addInput(value: Record<string, unknown>) {
  if (Object.keys(value).some(k => k !== "repositories")) throw new BffError(400, "invalid_request");
  return { repositories: repositoriesInput(value.repositories) };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BffError(503, "project_unavailable");
  return value as Record<string, unknown>;
}
function validStatus(value: unknown) { return typeof value === "string" && statuses.has(value); }
function validName(value: unknown) { return typeof value === "string" && value.length > 0 && value.length <= 100; }
function members(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 1000) throw new BffError(503, "project_unavailable");
  return value.map(raw => {
    const r = record(raw);
    const blocked = r.accessStatus === "BLOCKED";
    if (typeof r.id !== "string" || !uuid.test(r.id) ||
      !(blocked && r.githubRepositoryId === null || typeof r.githubRepositoryId === "string" && repositoryId.test(r.githubRepositoryId)) ||
      !(blocked && r.fullName === null || typeof r.fullName === "string" && /^[^/\s]+\/[^/\s]+$/.test(r.fullName)) || !["PUBLIC", "PRIVATE"].includes(String(r.visibility)) ||
      !["ACTIVE", "BLOCKED"].includes(String(r.accessStatus)) || !validStatus(r.analysisStatus) ||
      !(r.commitSha === null || typeof r.commitSha === "string" && /^[0-9a-f]{40}$/.test(r.commitSha)) || blocked && (r.githubRepositoryId !== null || r.fullName !== null || r.commitSha !== null)) throw new BffError(503, "project_unavailable");
    return { id: r.id, githubRepositoryId: r.githubRepositoryId, fullName: r.fullName, visibility: r.visibility,
      accessStatus: r.accessStatus, analysisStatus: r.analysisStatus, commitSha: r.commitSha };
  });
}
export function listOf(value: unknown) {
  if (!Array.isArray(value) || value.length > 1000) throw new BffError(503, "project_unavailable");
  return value.map(raw => {
    const r = record(raw);
    if (typeof r.id !== "string" || !uuid.test(r.id) || !validName(r.name) || !validStatus(r.analysisStatus) ||
      !Number.isSafeInteger(r.repositoryCount) || (r.repositoryCount as number) < 1 ||
      !Number.isSafeInteger(r.privateRepositoryCount) || (r.privateRepositoryCount as number) < 0 ||
      typeof r.canInterview !== "boolean") throw new BffError(503, "project_unavailable");
    return { id: r.id, name: r.name, analysisStatus: r.analysisStatus, repositoryCount: r.repositoryCount,
      privateRepositoryCount: r.privateRepositoryCount, canInterview: r.canInterview };
  });
}
export function detailOf(value: unknown) {
  const r = record(value);
  if (typeof r.id !== "string" || !uuid.test(r.id) || !validName(r.name) || !["ACTIVE", "DELETING"].includes(String(r.projectStatus)) ||
    !validStatus(r.analysisStatus) || r.canInterview !== false || r.canPrivateInterview !== false ||
    !Number.isSafeInteger(r.membershipVersion) || (r.membershipVersion as number) < 1)
    throw new BffError(503, "project_unavailable");
  const repositories = members(r.repositories);
  const snapshot = r.latestReadySnapshot === null ? null : snapshotOf(r.latestReadySnapshot);
  if (r.analysisStatus === "READY" && !snapshot ||
      snapshot && (new Set(repositories.map(m => m.id)).size !== repositories.length ||
        r.projectStatus !== "ACTIVE" || snapshot.membershipVersion !== r.membershipVersion ||
        snapshot.members.length !== repositories.length || repositories.some(repo =>
          repo.visibility !== "PUBLIC" || repo.accessStatus !== "ACTIVE" ||
          !snapshot.members.some(m => m.repositoryId === repo.id && m.githubRepositoryId === repo.githubRepositoryId &&
            (r.analysisStatus !== "READY" || m.commitSha === repo.commitSha)))))
    throw new BffError(503, "project_unavailable");
  return { id: r.id, name: r.name, projectStatus: r.projectStatus, analysisStatus: r.analysisStatus,
    canInterview: false, canPrivateInterview: false, latestReadySnapshot: snapshot,
    membershipVersion: r.membershipVersion, repositories };
}

function snapshotOf(value: unknown): AnalysisSnapshot {
  const fail = (): never => { throw new BffError(503, "project_unavailable"); };
  const text = (v: unknown, pattern: RegExp): string => typeof v === "string" && pattern.test(v) ? v : fail();
  const integer = (v: unknown, min: number, max = 2147483647): number =>
    typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max ? v : fail();
  const array = (v: unknown, min: number, max: number): unknown[] =>
    Array.isArray(v) && v.length >= min && v.length <= max ? v : fail();
  const unique = (items: string[]) => { if (new Set(items).size !== items.length) fail(); };
  const claim = (v: unknown): ClaimType =>
    v === "CODE_FACT" || v === "DOC_CLAIM" || v === "HYPOTHESIS" ? v : fail();
  const summary = (v: unknown) => typeof v === "string" && v.trim() && v.length <= 1000 &&
    !/[\x00-\x1f\x7f-\x9f]/.test(v) ? v : fail();
  const path = (v: unknown) => typeof v === "string" && v.trim() && v.length <= 1024 &&
    !/[\\:\x00-\x1f\x7f-\x9f]/.test(v) && !v.split("/").some(p => !p || p === "." || p === "..") ? v : fail();
  const r = record(value);
  const snapshotId = text(r.snapshotId, uuid);
  const membershipVersion = integer(r.membershipVersion, 1, Number.MAX_SAFE_INTEGER);
  const snapshotMembers = array(r.members, 1, 20).map(raw => {
    const m = record(raw);
    return { memberId: text(m.memberId, uuid), repositoryId: text(m.repositoryId, uuid),
      githubRepositoryId: text(m.githubRepositoryId, repositoryId), commitSha: text(m.commitSha, /^[0-9a-f]{40}$/) };
  });
  unique(snapshotMembers.map(m => m.memberId)); unique(snapshotMembers.map(m => m.repositoryId));
  unique(snapshotMembers.map(m => m.githubRepositoryId));
  const evidenceReferences = array(r.evidenceReferences, 1, 200).map(raw => {
    const e = record(raw);
    const m = snapshotMembers.find(m => m.memberId === e.memberId);
    if (!m || e.repositoryId !== m.repositoryId || e.githubRepositoryId !== m.githubRepositoryId || e.commitSha !== m.commitSha) return fail();
    const lineStart = e.lineStart === null ? null : integer(e.lineStart, 1);
    const lineEnd = e.lineEnd === null ? null : integer(e.lineEnd, 1);
    if ((lineStart === null) !== (lineEnd === null) || lineStart !== null && lineEnd! < lineStart) fail();
    return { ...m, id: text(e.id, uuid), filePath: path(e.filePath), lineStart, lineEnd,
      claimType: claim(e.claimType), summary: summary(e.summary) };
  });
  unique(evidenceReferences.map(e => e.id));
  if (!evidenceReferences.some(e => e.claimType === "CODE_FACT")) fail();
  const topics = array(r.topics, 1, 64).map(t => text(t, /^[A-Z][A-Z0-9_]{0,63}$/));
  unique(topics);
  const relations = array(r.relations, 0, 100).map(raw => {
    const v = record(raw);
    const fromMemberId = text(v.fromMemberId, uuid), toMemberId = text(v.toMemberId, uuid);
    const claimType = claim(v.claimType), evidenceIds = array(v.evidenceIds, 1, 200).map(id => text(id, uuid));
    unique(evidenceIds);
    if (fromMemberId === toMemberId || ![fromMemberId, toMemberId].every(id => snapshotMembers.some(m => m.memberId === id))) fail();
    const sources = new Set<string>();
    for (const id of evidenceIds) {
      const e = evidenceReferences.find(e => e.id === id);
      if (!e || claimType === "CODE_FACT" && e.claimType !== "CODE_FACT" ||
          claimType === "DOC_CLAIM" && e.claimType === "HYPOTHESIS") return fail();
      sources.add(e.memberId);
    }
    if (sources.size !== 2 || !sources.has(fromMemberId) || !sources.has(toMemberId)) fail();
    return { fromMemberId, toMemberId, claimType, evidenceIds, summary: summary(v.summary) };
  });
  const coverage = array(r.coverage, snapshotMembers.length, snapshotMembers.length).map(raw => {
    const c = record(raw);
    const memberId = text(c.memberId, uuid);
    if (!snapshotMembers.some(m => m.memberId === memberId)) fail();
    const exclusions = record(c.exclusions);
    if (Object.keys(exclusions).length > 32) fail();
    return { memberId, collectedFiles: integer(c.collectedFiles, 0, 40), skippedFiles: integer(c.skippedFiles, 0),
      selectedPaths: array(c.selectedPaths, 0, 40).map(path),
      exclusions: Object.fromEntries(Object.entries(exclusions).map(([k, v]) => [text(k, /^[a-z_]{1,40}$/), integer(v, 0)])) };
  });
  unique(coverage.map(c => c.memberId));
  if (coverage.reduce((n, c) => n + c.collectedFiles, 0) > 40) fail();
  return { snapshotId, membershipVersion, members: snapshotMembers, topics, relations, coverage, evidenceReferences };
}
export function registrationOf(value: unknown) {
  const r = record(value);
  if (typeof r.id !== "string" || !uuid.test(r.id) || !validStatus(r.analysisStatus)) throw new BffError(503, "project_unavailable");
  return { id: r.id, analysisStatus: r.analysisStatus, repositories: members(r.repositories) };
}
export function additionOf(value: unknown) {
  const r = record(value);
  if (typeof r.projectId !== "string" || !uuid.test(r.projectId) || !validStatus(r.analysisStatus) ||
    !Number.isSafeInteger(r.membershipVersion) || (r.membershipVersion as number) < 2)
    throw new BffError(503, "project_unavailable");
  return { projectId: r.projectId, membershipVersion: r.membershipVersion, analysisStatus: r.analysisStatus,
    repositories: members(r.repositories) };
}

export async function projectRequest(path: string, method: "GET" | "POST" | "DELETE", expected: 200 | 201 | 204,
  body?: object, key?: string): Promise<unknown> {
  const configured = process.env.PROJECT_INTERNAL_URL;
  let target: URL;
  try {
    if (!configured || !/^\/api\/projects(?:\/[0-9a-f-]{36}(?:\/repositories(?:\/[0-9a-f-]{36})?)?)?$/i.test(path)) throw new Error();
    const base = new URL(configured);
    if (!/^https?:$/.test(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== "/") throw new Error();
    target = new URL(path, base);
    if (target.origin !== base.origin) throw new Error();
  } catch { throw new BffError(503, "web_configuration_error"); }
  const { token } = await jwt();
  let response: Response;
  try {
    response = await fetch(target, { method, cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(8000),
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}), ...(key ? { "Idempotency-Key": key } : {}) },
      body: body ? JSON.stringify(body) : undefined });
  } catch { throw new BffError(503, "project_unavailable"); }
  if (response.status >= 300 && response.status < 400) throw new BffError(503, "project_unavailable");
  if (response.status === 204 && expected === 204) return null;
  // A bounded P-03 can contain 200 evidence entries and 100 relations; other endpoints keep their existing cap.
  const maxBytes = method === "GET" && /^\/api\/projects\/[0-9a-f-]{36}$/i.test(path) ? 8 * 1024 * 1024 : 131072;
  const length = Number(response.headers.get("content-length") ?? 0);
  if (!Number.isFinite(length) || length > maxBytes) { await response.body?.cancel(); throw new BffError(503, "project_unavailable"); }
  let data: unknown;
  try {
    const reader = response.body?.getReader(); if (!reader) throw new Error();
    const parts: Uint8Array[] = []; let size = 0;
    while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new Error(); } parts.push(part.value); }
    data = JSON.parse(Buffer.concat(parts).toString("utf8"));
  } catch { throw new BffError(503, "project_unavailable"); }
  if (response.status === expected) return data;
  const error = record(data).code;
  if (typeof error === "string" && errors[error]?.includes(response.status))
    throw new BffError(response.status, error);
  throw new BffError(503, "project_unavailable");
}
