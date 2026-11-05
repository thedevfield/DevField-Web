import test from "node:test";
import { consentDecisions, cleanupPending, privateEntries } from "../src/app/app/repoq/consents.ts";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const listen = server => new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
const close = server => new Promise(resolve => server.close(resolve));
const id = "11111111-1111-4111-8111-111111111111", memberId = "22222222-2222-4222-8222-222222222222";
const privateEntry = { githubRepositoryId: "72", consents: [
  { purpose: "PRIVATE_COLLECTION", decision: "GRANTED", policyVersion: "test-v1" },
  { purpose: "EXTERNAL_AI", decision: "DENIED", policyVersion: "test-v1" },
] };
const blocked = { id: memberId, githubRepositoryId: null, fullName: null, visibility: "PRIVATE", accessStatus: "BLOCKED", analysisStatus: "FAILED", commitSha: null };
const publicMember = { id: memberId, githubRepositoryId: "73", fullName: "org/public", visibility: "PUBLIC", accessStatus: "ACTIVE", analysisStatus: "QUEUED", commitSha: null };

test("Private Project BFF accepts gated mixed input and redacted detail", { timeout: 120000 }, async () => {
  const calls = [];
  let detailMember = blocked;
  let rejection = null;
  const auth = createServer((req, res) => { res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ accessToken: "fixture-jwt", tokenType: "Bearer", expiresAt: new Date(Date.now() + 60000).toISOString() })); });
  const project = createServer(async (req, res) => {
    let raw = ""; for await (const chunk of req) raw += chunk;
    calls.push({ path: req.url, method: req.method, input: raw ? JSON.parse(raw) : null });
    res.setHeader("Content-Type", "application/json");
    if (rejection && req.method === "POST") return res.writeHead(409).end(JSON.stringify({ code: rejection, detail: "must-not-leak" }));
    const members = [publicMember, { ...blocked, githubRepositoryId: "72", fullName: "org/private", accessStatus: "ACTIVE" }];
    if (req.url === "/api/projects" && req.method === "POST") return res.writeHead(201).end(JSON.stringify({ id, analysisStatus: "QUEUED", repositories: members }));
    if (req.url === `/api/projects/${id}/repositories` && req.method === "POST") return res.writeHead(201).end(JSON.stringify({ projectId: id, membershipVersion: 2, analysisStatus: "QUEUED", repositories: members }));
    if (req.url === `/api/projects/${id}`) return res.end(JSON.stringify({ id, name: "Private access unavailable", projectStatus: "ACTIVE", analysisStatus: "FAILED", canInterview: false, canPrivateInterview: false, latestReadySnapshot: null, membershipVersion: 2, repositories: [publicMember, detailMember] }));
    res.writeHead(404).end(JSON.stringify({ code: "project_not_found" }));
  });
  const authPort = await listen(auth), projectPort = await listen(project), probe = createServer(), webPort = await listen(probe); await close(probe);
  const origin = `http://127.0.0.1:${webPort}`;
  const next = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", String(webPort), "-H", "127.0.0.1"], { cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: "development", WEB_PUBLIC_ORIGIN: origin, AUTH_INTERNAL_URL: `http://127.0.0.1:${authPort}`,
      PROJECT_INTERNAL_URL: `http://127.0.0.1:${projectPort}`, WEB_PRIVATE_REGISTRATION_ENABLED: "true",
      WEB_CSRF_SECRET: "isolated-test-secret-at-least-32-characters", DEVFIELD_BFF_SERVICE_KEY: "test-key" }, stdio: "ignore" });
  try {
    let ready = false;
    for (let i = 0; i < 80; i++) { try { if ((await fetch(origin + "/api/health")).ok) { ready = true; break; } } catch {} await delay(250); }
    assert.ok(ready);
    const get = path => fetch(origin + path, { headers: { Cookie: "DF_WEB_SESSION_DEV=alice" } });
    const csrf = await get("/api/auth/csrf"), cookie = csrf.headers.get("set-cookie").split(";")[0], { token } = await csrf.json();
    const post = (path, input, key) => fetch(origin + path, { method: "POST", headers: { Cookie: `DF_WEB_SESSION_DEV=alice; ${cookie}`, Origin: origin,
      "x-devfield-csrf": token, "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify(input) });
    const publicEntry = { repositoryUrl: "https://github.com/org/public" };
    assert.equal((await post("/api/repoq/projects", { name: "X", repositories: [privateEntry] }, "private-only")).status, 201);
    assert.equal((await post("/api/repoq/projects", { name: "X", repositories: [publicEntry, privateEntry] }, "mixed")).status, 201);
    assert.equal((await post(`/api/repoq/projects/${id}/repositories`, { repositories: [privateEntry] }, "add-private")).status, 201);
    assert.equal((await post("/api/repoq/projects", { name: "X", repositories: [{ ...privateEntry, githubRepositoryId: "9007199254740993" }] }, "large-id")).status, 201);
    assert.equal((await post("/api/repoq/projects", { name: "X", repositories: [privateEntry, privateEntry] }, "duplicate")).status, 409);
    assert.equal((await post("/api/repoq/projects", { name: "X", repositories: [{ ...privateEntry, consents: [privateEntry.consents[1]] }] }, "missing-consent")).status, 400);
    assert.equal((await post("/api/repoq/projects", { name: "X", repositories: [{ ...privateEntry, consents: [{ ...privateEntry.consents[0], decision: "DENIED" }, privateEntry.consents[1]] }] }, "denied")).status, 403);
    assert.equal(calls.find(call => call.input?.name === "X" && call.input.repositories[0].githubRepositoryId === "9007199254740993").input.repositories[0].githubRepositoryId, "9007199254740993");
    const detail = await get(`/api/repoq/projects/${id}`);
    assert.equal(detail.status, 200);
    const data = await detail.json();
    assert.equal(data.repositories[1].fullName, null);
    assert.equal(data.repositories[0].fullName, "org/public");
    for (const code of ["revocation_in_progress", "revocation_required"]) {
      rejection = code;
      for (const path of ["/api/repoq/projects", `/api/repoq/projects/${id}/repositories`]) {
        const response = await post(path, { ...(path.endsWith("projects") ? { name: "X" } : {}), repositories: [privateEntry] }, code);
        assert.equal(response.status, 409);
        const data = await response.json(); assert.equal(data.code, code); assert.equal(JSON.stringify(data).includes("must-not-leak"), false);
      }
    }
    detailMember = { ...publicMember, visibility: "PRIVATE", fullName: null };
    assert.equal((await get(`/api/repoq/projects/${id}`)).status, 503);
  } finally { next.kill(); await close(auth); await close(project); }
});

const status = () => ({ githubRepositoryId: "72", currentPolicyVersion: "v2", consentSubmissionAvailable: true,
  consents: [ { purpose: "PRIVATE_COLLECTION", decision: "GRANTED", policyVersion: "v1", cleanupState: null },
    { purpose: "EXTERNAL_AI", decision: "DENIED", policyVersion: "v1", cleanupState: null } ] });
const choice = state => ({ id: "72", name: "fixture/private", status: state, collection: "GRANTED", ai: "DENIED", error: "" });

test("Explicit decisions use current policy for both purposes without filling missing choices", () => {
  const saved = status();
  const input = consentDecisions(saved, "GRANTED", "DENIED");
  assert.deepEqual(input.map(c => [c.decision, c.policyVersion]), [["GRANTED", "v2"], ["DENIED", "v2"]]);
  assert.equal(saved.consents[0].policyVersion, "v1");
  for (const decisions of [["", "DENIED"], ["GRANTED", ""], ["", ""]])
    assert.throws(() => consentDecisions(saved, ...decisions));
  saved.consents[1] = { ...saved.consents[1], decision: null, policyVersion: null };
  assert.throws(() => consentDecisions(saved, "GRANTED", ""));
  saved.currentPolicyVersion = null; saved.consentSubmissionAvailable = false;
  assert.throws(() => consentDecisions(saved, "GRANTED", "DENIED"));
});

test("Picker blocks incomplete cleanup for either purpose, including DENIED masking", async () => {
  for (const purposeIndex of [0, 1]) for (const cleanupState of ["PENDING", "UNKNOWN", null]) {
    const saved = status(); saved.consents[purposeIndex] = { ...saved.consents[purposeIndex], decision: "REVOKED", cleanupState };
    assert.equal(cleanupPending(saved), true);
    for (const ai of ["GRANTED", "DENIED"])
      await assert.rejects(privateEntries([{ ...choice(saved), ai }], async () => saved));
  }
});

test("NO_DERIVED_DATA allows explicit reconsent but never a DENIED overwrite", async () => {
  const saved = status(); saved.consents = saved.consents.map(c => ({ ...c, decision: "REVOKED", cleanupState: "NO_DERIVED_DATA" }));
  assert.equal(cleanupPending(saved), false);
  const result = await privateEntries([{ ...choice(saved), ai: "GRANTED" }], async () => saved);
  assert.deepEqual(result[0].consents.map(c => [c.decision, c.policyVersion]), [["GRANTED", "v2"], ["GRANTED", "v2"]]);
  await assert.rejects(privateEntries([choice(saved)], async () => saved));
  assert.deepEqual(consentDecisions(saved, "GRANTED", "REVOKED")[1], { purpose: "EXTERNAL_AI", decision: "REVOKED", policyVersion: null });
});

test("Private submit refreshes status, rejects failure or change, Public needs no lookup", async () => {
  const saved = status(); let reads = 0;
  assert.equal((await privateEntries([choice(saved)], async () => { reads++; return saved; })).length, 1);
  assert.equal(reads, 1);
  await assert.rejects(privateEntries([choice(saved)], async () => { throw Error("unavailable"); }));
  for (const modify of [s => { s.currentPolicyVersion = "v3"; }, s => { s.consents[0].decision = "REVOKED"; s.consents[0].cleanupState = "NO_DERIVED_DATA"; }, s => { s.consents[1].policyVersion = "v2"; }]) {
    const current = structuredClone(saved); modify(current);
    await assert.rejects(privateEntries([choice(saved)], async () => current));
  }
  assert.deepEqual(await privateEntries([], async () => { throw Error("Public must not fetch"); }), []);
  await assert.rejects(privateEntries([{ ...choice(saved), ai: "" }], async () => saved));
});
