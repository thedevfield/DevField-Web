import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const listen = server => new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
const close = server => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
const id = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const send = (res, status, value) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(value)); };
const evaluation = { evidenceId: id, strengths: "good", gaps: "gap", improvements: "improve", exampleAnswer: "example", keyPoints: "point", limitations: "limits" };
const bundles = Array.from({ length: 5 }, (_, i) => ({ bundleId: `11111111-1111-4111-8111-11111111111${i}`, sequence: i + 1,
  topicKey: "JAVA", answers: [{ questionId: other, question: "Question?", answer: "Answer." }], evaluation }));
const summary = { strengths: "good", gaps: "gap", consistency: "consistent", studyAreas: "tests", limitations: "limits" };

test("Interview BFF applies auth, mutation guards and the seven API contracts", { timeout: 120000 }, async () => {
  const calls = [];
  let mode = "FREE", status = "ACTIVE", extra = {}, failure;
  const auth = createServer((req, res) => {
    if (req.url !== "/internal/auth/session-token" || req.headers["x-devfield-service-key"] !== "test-key") return send(res, 403, { code: "forbidden" });
    if (req.headers["x-devfield-session-handle"] !== "alice") return send(res, 401, { code: "invalid_session" });
    return send(res, 200, { accessToken: "private-jwt", tokenType: "Bearer", expiresAt: new Date(Date.now() + 60000).toISOString() });
  });
  const backend = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    calls.push([req.method, req.url, raw ? JSON.parse(raw) : null]);
    if (req.headers.authorization !== "Bearer private-jwt") return send(res, 401, { code: "invalid_token" });
    if (failure === "redirect") return res.writeHead(302, { Location: "https://invalid.example/" }).end();
    if (failure === "auth") return send(res, 403, { code: "account_unavailable", secret: "never forward" });
    const detail = { interviewId: id, mode, status, completedBundles: 0, snapshotId: other, topicKey: mode === "FREE" ? "JAVA" : null,
      currentBundleId: id, answers: [], secret: "never forward", ...extra };
    if (req.method === "GET" && req.url.startsWith("/api/interviews?"))
      return send(res, 200, { items: [{ interviewId: id, mode, status, completedBundles: 0, createdAt: "2026-11-01T12:00:00Z" }], nextCursor: null });
    if (req.method === "GET") return send(res, 200, detail);
    if (req.url === "/api/interviews" && req.method === "POST") return send(res, 201, { ...detail, status: "PREPARING" });
    if (req.url.endsWith("/answers")) return failure === "conflict" ? send(res, 409, { code: "answer_conflict" }) : send(res, 202, { status: "ACCEPTED" });
    if (req.url.endsWith("/bundles")) return send(res, 202, { status: "ACCEPTED", bundleId: other });
    if (req.method === "PATCH") return send(res, 200, { status: "PAUSED" });
    if (req.method === "DELETE") return res.writeHead(204).end();
    return send(res, 404, { code: "interview_not_found" });
  });
  const authPort = await listen(auth), backendPort = await listen(backend);
  const probe = createServer(), webPort = await listen(probe); await close(probe);
  const origin = `http://127.0.0.1:${webPort}`;
  const next = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--webpack", "-p", String(webPort), "-H", "127.0.0.1"], {
    env: { ...process.env, NODE_ENV: "development", WEB_PUBLIC_ORIGIN: origin, AUTH_INTERNAL_URL: `http://127.0.0.1:${authPort}`,
      INTERVIEW_INTERNAL_URL: `http://127.0.0.1:${backendPort}`, WEB_FREE_INTERVIEW_ENABLED: "true", WEB_MOCK_INTERVIEW_ENABLED: "true",
      WEB_CSRF_SECRET: "isolated-test-secret-at-least-32-characters", DEVFIELD_BFF_SERVICE_KEY: "test-key" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let logs = ""; next.stderr.on("data", data => logs += data);
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) { try { if ((await fetch(origin + "/api/health")).ok) { ready = true; break; } } catch {} await delay(250); }
    assert.ok(ready, logs);
    const path = "/api/repoq/interviews";
    const cookie = "DF_WEB_SESSION_DEV=alice";
    const get = (p, session = cookie) => fetch(origin + p, { headers: { Cookie: session } });
    const csrf = await get("/api/auth/csrf");
    const csrfCookie = csrf.headers.get("set-cookie").split(";")[0];
    const { token } = await csrf.json();
    const mutate = (method, p, body, headers = {}) => fetch(origin + p, { method,
      headers: { Cookie: cookie + "; " + csrfCookie, Origin: origin, "x-devfield-csrf": token, "Content-Type": "application/json", ...headers },
      body: body ? JSON.stringify(body) : undefined });
    assert.equal((await get(path + "/" + id, "")).status, 401);
    assert.equal((await get(path)).status, 400);
    assert.equal((await mutate("POST", path, { mode: "FREE" }, { Origin: "https://evil.example" })).status, 403);
    assert.equal((await mutate("DELETE", path + "/" + id, undefined, { "x-devfield-csrf": "bad" })).status, 403);
    assert.equal((await mutate("HEAD", path + "/" + id)).status, 405);
    assert.equal(calls.length, 0);

    const started = await mutate("POST", path, { projectId: other, mode, topicKey: "JAVA" });
    assert.equal(started.status, 201);
    assert.equal(started.headers.get("cache-control"), "no-store");
    const created = await started.json();
    assert.equal(created.status, "PREPARING");
    assert.equal(created.secret, undefined);
    assert.equal((await get(path + "?projectId=" + other + "&limit=1")).status, 200);
    const free = await get(path + "/" + id);
    assert.equal(free.status, 200);
    extra = { evaluationStatus: "READY", evaluation, completedBundleHistory: bundles.slice(0, 1) };
    const freeReady = await (await get(path + "/" + id)).json();
    assert.equal(freeReady.evaluation.exampleAnswer, "example");
    assert.equal(freeReady.completedBundleHistory.length, 1);
    extra = {};
    const answer = { questionId: other, answer: "  retained  ", submissionId: "same-id" };
    assert.equal((await mutate("POST", path + "/" + id + "/answers", answer)).status, 202);
    assert.deepEqual(calls.at(-1)[2], answer);
    failure = "conflict";
    assert.equal((await mutate("POST", path + "/" + id + "/answers", answer)).status, 409);
    assert.deepEqual(calls.at(-1)[2], answer);
    failure = undefined;
    assert.equal((await mutate("POST", path + "/" + id + "/bundles", { previousBundleId: id, topicKey: "RANDOM" })).status, 202);
    assert.equal((await mutate("PATCH", path + "/" + id, { action: "PAUSE" })).status, 200);
    const deleted = await mutate("DELETE", path + "/" + id);
    assert.equal(deleted.status, 204);
    assert.equal(await deleted.text(), "");

    mode = "MOCK"; status = "EVALUATING";
    extra = { completedBundles: 5, evaluationStatus: "PENDING" };
    assert.equal((await get(path + "/" + id)).status, 200);
    extra.completedBundleHistory = bundles.slice(0, 1);
    assert.equal((await get(path + "/" + id)).status, 503);
    status = "COMPLETED";
    extra = { completedBundles: 5, evaluationStatus: "READY", completedBundleHistory: bundles, sessionEvaluation: summary };
    assert.equal((await (await get(path + "/" + id)).json()).completedBundleHistory.length, 5);
    status = "ACTIVE"; extra = {};
    assert.equal((await mutate("POST", path, { projectId: other, mode, topicKey: "JAVA" })).status, 400);
    assert.equal((await mutate("POST", path, { projectId: other, mode })).status, 201);
    assert.deepEqual(calls.at(-1)[2], { projectId: other, mode });
    assert.equal((await mutate("PATCH", path + "/" + id, { action: "END" })).status, 400);
    assert.equal((await mutate("DELETE", path + "/" + id + "?confirmAbandon=true")).status, 204);
    assert.equal(calls.at(-1)[1], "/api/interviews/" + id + "?confirmAbandon=true");
    failure = "auth";
    assert.deepEqual(await (await get(path + "/" + id)).json(), { code: "account_unavailable" });
    failure = "redirect";
    assert.equal((await get(path + "/" + id)).status, 503);
  } finally { next.kill(); await close(auth); await close(backend); }
});
