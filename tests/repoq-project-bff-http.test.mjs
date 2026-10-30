import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const listen = server => new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
const close = server => new Promise(resolve => server.close(resolve));
const id = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const memberA = "33333333-3333-4333-8333-333333333333";
const memberB = "44444444-4444-4444-8444-444444444444";
const member = (memberId, repoId, name) => ({ id: memberId, githubRepositoryId: repoId, fullName: name,
  visibility: "PUBLIC", accessStatus: "ACTIVE", analysisStatus: "QUEUED", commitSha: null });
const read = request => new Promise(resolve => { let raw = ""; request.on("data", chunk => raw += chunk);
  request.on("end", () => resolve(raw ? JSON.parse(raw) : null)); });
const send = (res, status, value) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(value)); };

test("RepoQ Project BFF validates input, ownership responses, and server-only credentials", { timeout: 120000 }, async () => {
  let authDown = false, projectDown = false, redirect = false, oversized = false, running = false;
  let members = [member(memberA, "72", "org/one")];
  let version = 1;
  const calls = [], replay = new Map();
  const auth = createServer((req, res) => {
    if (authDown) return send(res, 503, { code: "auth_unavailable" });
    if (req.url !== "/internal/auth/session-token" || req.headers["x-devfield-service-key"] !== "test-key") return send(res, 403, { code: "forbidden" });
    if (req.headers["x-devfield-session-handle"] !== "alice") return send(res, 401, { code: "invalid_session" });
    send(res, 200, { accessToken: "jwt-alice", tokenType: "Bearer", expiresAt: new Date(Date.now() + 60000).toISOString() });
  });
  const project = createServer(async (req, res) => {
    const input = await read(req);
    calls.push({ path: req.url, method: req.method, authorization: req.headers.authorization, key: req.headers["idempotency-key"], input });
    if (projectDown) return send(res, 503, { code: "project_unavailable" });
    if (redirect) return res.writeHead(302, { Location: "https://evil.example/" }).end();
    if (oversized) return res.writeHead(200, { "Content-Type": "application/json", "Content-Length": "200000" }).end("{}");
    if (req.headers.authorization !== "Bearer jwt-alice") return send(res, 401, { code: "invalid_token" });
    if (req.url === "/api/projects" && req.method === "GET")
      return send(res, 200, [{ id, name: "Workspace", analysisStatus: "QUEUED", repositoryCount: members.length, privateRepositoryCount: 0, canInterview: false }]);
    if (req.url === "/api/projects" && req.method === "POST") {
      const key = req.headers["idempotency-key"], fingerprint = JSON.stringify(input);
      if (replay.has(`create:${key}`)) { const prior = replay.get(`create:${key}`); return prior.fingerprint === fingerprint ? send(res, 201, prior.data) : send(res, 409, { code: "idempotency_key_conflict" }); }
      const data = { id, analysisStatus: "QUEUED", repositories: input.repositories.map((_, index) => member(index ? memberB : memberA, String(72 + index), index ? "org/two" : "org/one")) };
      replay.set(`create:${key}`, { fingerprint, data }); return send(res, 201, data);
    }
    if (req.url === `/api/projects/${other}`) return send(res, 404, { code: "project_not_found" });
    if (req.url === `/api/projects/${id}` && req.method === "GET") return send(res, 200, { id, name: "Workspace", projectStatus: "ACTIVE", analysisStatus: running ? "RUNNING" : "QUEUED", canInterview: false,
      canPrivateInterview: false, latestReadySnapshot: null, membershipVersion: version, repositories: members });
    if (req.url === `/api/projects/${id}/repositories` && req.method === "POST") {
      if (running) return send(res, 409, { code: "analysis_in_progress" });
      const key = req.headers["idempotency-key"], fingerprint = JSON.stringify(input);
      if (replay.has(`add:${key}`)) { const prior = replay.get(`add:${key}`); return prior.fingerprint === fingerprint ? send(res, 201, prior.data) : send(res, 409, { code: "idempotency_key_conflict" }); }
      members = [...members, member(memberB, "73", "org/two")]; version++;
      const data = { projectId: id, membershipVersion: version, analysisStatus: "QUEUED", repositories: members };
      replay.set(`add:${key}`, { fingerprint, data }); return send(res, 201, data);
    }
    if ([`/api/projects/${id}/repositories/${memberA}`, `/api/projects/${id}/repositories/${memberB}`].includes(req.url) && req.method === "DELETE") {
      if (members.length <= 1) return send(res, 409, { code: "last_repository_required" });
      if (running) return send(res, 409, { code: "analysis_in_progress" });
      members = members.filter(m => m.id !== req.url.split("/").at(-1)); version++; return res.writeHead(204).end();
    }
    return send(res, 404, { code: "project_not_found" });
  });
  const authPort = await listen(auth), projectPort = await listen(project);
  const probe = createServer(), webPort = await listen(probe); await close(probe);
  const webOrigin = `http://127.0.0.1:${webPort}`;
  const next = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", String(webPort), "-H", "127.0.0.1"], { cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: "development", WEB_PUBLIC_ORIGIN: webOrigin, AUTH_INTERNAL_URL: `http://127.0.0.1:${authPort}`,
      PROJECT_INTERNAL_URL: `http://127.0.0.1:${projectPort}`, WEB_CSRF_SECRET: "isolated-test-secret-at-least-32-characters",
      DEVFIELD_BFF_SERVICE_KEY: "test-key" }, stdio: ["ignore", "ignore", "pipe"] });
  let nextErrors = ""; next.stderr.on("data", data => nextErrors += data);
  try {
    let ready = false;
    for (let i = 0; i < 80; i++) { try { if ((await fetch(`${webOrigin}/api/health`)).ok) { ready = true; break; } } catch {} await delay(250); }
    assert.ok(ready, nextErrors);
    const get = (path, cookie = "DF_WEB_SESSION_DEV=alice") => fetch(webOrigin + path, { headers: { Cookie: cookie }, redirect: "manual" });
    assert.equal((await get("/api/repoq/projects", "")).status, 401);
    assert.equal((await get("/api/repoq/projects", "DF_WEB_SESSION_DEV=expired")).status, 401);
    const list = await get("/api/repoq/projects");
    assert.equal(list.status, 200); assert.equal((await list.json())[0].repositoryCount, 1);
    assert.equal((await get("/api/repoq/projects?owner=bob")).status, 400);
    assert.equal((await get(`/api/repoq/projects/${other}`)).status, 404);
    assert.equal((await get(`/api/repoq/projects/${id}`)).status, 200);
    const csrf = await get("/api/auth/csrf"), csrfCookie = csrf.headers.get("set-cookie").split(";")[0];
    const { token } = await csrf.json();
    const cookie = `DF_WEB_SESSION_DEV=alice; ${csrfCookie}`;
    const post = (path, input, key, headers = {}) => fetch(webOrigin + path, { method: "POST", redirect: "manual",
      headers: { Cookie: cookie, Origin: webOrigin, "x-devfield-csrf": token, "Content-Type": "application/json", "Idempotency-Key": key, ...headers }, body: JSON.stringify(input) });
    const create = { name: " Workspace ", repositories: [{ repositoryUrl: "https://github.com/org/one" }, { repositoryUrl: "https://github.com/org/two" }] };
    assert.equal((await post("/api/repoq/projects", create, "create-key", { Origin: "https://evil.example" })).status, 403);
    assert.equal((await post("/api/repoq/projects", { name: " ", repositories: create.repositories }, "bad-name")).status, 400);
    assert.equal((await post("/api/repoq/projects", { name: "X", repositories: [] }, "bad-count")).status, 400);
    assert.equal((await post("/api/repoq/projects", { name: "X", repositories: Array.from({ length: 21 }, (_, i) => ({ repositoryUrl: `https://github.com/org/repo${i}` })) }, "too-many")).status, 400);
    assert.equal((await post("/api/repoq/projects", { name: "X", repositories: [{ repositoryUrl: "http://evil.example/x" }] }, "bad-url")).status, 400);
    assert.equal((await post("/api/repoq/projects", { name: "X", repositories: [create.repositories[0], create.repositories[0]] }, "dupe")).status, 409);
    assert.equal((await post("/api/repoq/projects", create, "create-key", { "x-devfield-csrf": "bad" })).status, 403);
    assert.equal((await post("/api/repoq/projects", create, "bad key")).status, 400);
    assert.equal((await post("/api/repoq/projects", { ...create, padding: "x".repeat(9000) }, "too-large")).status, 413);
    const created = await post("/api/repoq/projects", create, "create-key");
    assert.equal(created.status, 201); assert.equal((await created.json()).repositories.length, 2);
    assert.equal((await post("/api/repoq/projects", create, "create-key")).status, 201);
    assert.equal((await post("/api/repoq/projects", { ...create, name: "Different" }, "create-key")).status, 409);
    const addPath = `/api/repoq/projects/${id}/repositories`;
    assert.equal((await post(addPath, { repositories: [create.repositories[1]] }, "add-key")).status, 201);
    assert.equal((await post(addPath, { repositories: [create.repositories[1]] }, "add-key")).status, 201);
    assert.equal((await post(addPath, { repositories: [create.repositories[0]] }, "add-key")).status, 409);
    const remove = () => fetch(webOrigin + `${addPath}/${memberA}`, { method: "DELETE", redirect: "manual",
      headers: { Cookie: cookie, Origin: webOrigin, "x-devfield-csrf": token } });
    running = true;
    assert.equal((await post(addPath, { repositories: [create.repositories[1]] }, "running-key")).status, 409);
    assert.equal((await remove()).status, 409); running = false;
    assert.equal((await remove()).status, 204);
    const last = await fetch(webOrigin + `${addPath}/${memberB}`, { method: "DELETE", headers: { Cookie: cookie, Origin: webOrigin, "x-devfield-csrf": token } });
    assert.equal(last.status, 409); assert.equal((await last.json()).code, "last_repository_required");
    authDown = true; assert.equal((await get("/api/repoq/projects")).status, 503); authDown = false;
    projectDown = true; assert.equal((await get("/api/repoq/projects")).status, 503); projectDown = false;
    redirect = true; assert.equal((await get("/api/repoq/projects")).status, 503); redirect = false;
    oversized = true; assert.equal((await get("/api/repoq/projects")).status, 503); oversized = false;
    assert.ok(calls.every(call => call.authorization === "Bearer jwt-alice"));
    assert.ok(calls.every(call => !JSON.stringify(call.input).includes("jwt-alice")));
    assert.doesNotMatch(JSON.stringify(await (await get("/api/repoq/projects")).json()), /jwt-alice|test-key|DF_WEB_SESSION_DEV/);
  } finally { next.kill(); await close(auth); await close(project); }
});
