import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const listen = server => new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
const close = server => new Promise(resolve => server.close(resolve));
const proof = "p".repeat(43);
const body = request => new Promise(resolve => { let raw = ""; request.on("data", chunk => raw += chunk); request.on("end", () => resolve(raw ? JSON.parse(raw) : {})); });

test("GitHub App BFF binds the attempt to the session and validates Project responses", { timeout: 120000 }, async () => {
  let action = "AUTHORIZE_USER", badUrl = false, expired = false, shortExpiry = false, pending = false, badRepo = false, projectDown = false, authDown = false, callbackConsumed = false, callbackFailure = null;
  const calls = [];
  let webOrigin;
  const auth = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (authDown) return res.writeHead(503).end(JSON.stringify({ code: "auth_unavailable" }));
    if (req.url !== "/internal/auth/session-token" || req.headers["x-devfield-service-key"] !== "test-key") return res.writeHead(403).end();
    if (req.headers["x-devfield-session-handle"] !== "alice" && req.headers["x-devfield-session-handle"] !== "bob") return res.writeHead(401).end(JSON.stringify({ code: "invalid_session" }));
    res.end(JSON.stringify({ accessToken: `jwt-${req.headers["x-devfield-session-handle"]}`, tokenType: "Bearer", expiresAt: new Date(Date.now() + 60000).toISOString() }));
  });
  const project = createServer(async (req, res) => {
    const input = await body(req); calls.push({ path: req.url, authorization: req.headers.authorization, input });
    res.setHeader("Content-Type", "application/json");
    if (projectDown) return res.writeHead(503).end(JSON.stringify({ code: "project_unavailable" }));
    if (req.headers.authorization !== "Bearer jwt-alice" && req.headers.authorization !== "Bearer jwt-bob") return res.writeHead(401).end(JSON.stringify({ code: "invalid_session" }));
    if (req.url === "/api/github/connections/start") {
      const url = action === "AUTHORIZE_USER" ? `https://github.com/login/oauth/authorize?client_id=app&redirect_uri=${encodeURIComponent(webOrigin + "/api/github/connections/callback")}&state=${proof}&code_challenge=${"c".repeat(43)}&code_challenge_method=S256` : "https://github.com/apps/repoq/installations/new";
      return res.end(JSON.stringify({ nextAction: action, url: badUrl ? "https://evil.example/steal" : url, proof, expiresAt: new Date(Date.now() + (expired ? -1000 : shortExpiry ? 700 : 300000)).toISOString() }));
    }
    if (req.url === "/api/github/connections/callback/complete") {
      if (callbackFailure) return res.writeHead(callbackFailure.status).end(JSON.stringify({ code: callbackFailure.code }));
      if (callbackConsumed) return res.writeHead(403).end(JSON.stringify({ code: "github_attempt_invalid" }));
      callbackConsumed = true;
      return res.end(JSON.stringify({ userAuthorization: "AUTHORIZED", installation: "NOT_INSTALLED" }));
    }
    if (req.url === "/api/github/connections/setup/complete") {
      if (input.installationId !== 51) return res.writeHead(403).end(JSON.stringify({ code: "github_installation_unavailable" }));
      return res.end(JSON.stringify({ userAuthorization: "AUTHORIZED", installation: pending ? "PENDING_APPROVAL" : "INSTALLED" }));
    }
    if (req.url === "/api/github/connections") return res.end(JSON.stringify({ userAuthorization: "AUTHORIZED", installation: pending ? "PENDING_APPROVAL" : "INSTALLED", token: "must-not-leak" }));
    if (req.url?.startsWith("/api/github/repositories")) return res.end(JSON.stringify({ status: pending ? "INSTALLATION_PENDING" : "CONNECTED", page: 1, hasNext: false, repositories: pending ? [] : [{ id: 72, fullName: "org/repo", name: "repo", isPrivate: true, ownerUserId: badRepo ? "bob" : undefined }] }));
    res.writeHead(404).end(JSON.stringify({ code: "not_found" }));
  });
  const authPort = await listen(auth), projectPort = await listen(project);
  const probe = createServer(), webPort = await listen(probe); await close(probe);
  webOrigin = `http://127.0.0.1:${webPort}`;
  const next = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", String(webPort), "-H", "127.0.0.1"], { cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: "development", WEB_PUBLIC_ORIGIN: webOrigin, AUTH_INTERNAL_URL: `http://127.0.0.1:${authPort}`, PROJECT_INTERNAL_URL: `http://127.0.0.1:${projectPort}`, WEB_CSRF_SECRET: "isolated-test-secret-at-least-32-characters", DEVFIELD_BFF_SERVICE_KEY: "test-key" }, stdio: ["ignore", "ignore", "pipe"] });
  let nextErrors = ""; next.stderr.on("data", data => nextErrors += data);
  try {
    let ready = false;
    for (let i = 0; i < 80; i++) { try { if ((await fetch(`${webOrigin}/api/health`)).ok) { ready = true; break; } } catch {} await delay(250); }
    assert.ok(ready);
    const get = (path, cookie = "") => fetch(webOrigin + path, { headers: { Cookie: cookie }, redirect: "manual" });
    assert.equal((await get("/api/github/connections")).status, 401);
    assert.equal((await get("/api/github/repositories?page=1&userId=bob", "DF_WEB_SESSION_DEV=alice")).status, 400);
    const csrf = await get("/api/auth/csrf", "DF_WEB_SESSION_DEV=alice");
    const csrfCookie = csrf.headers.get("set-cookie").split(";")[0], { token } = await csrf.json();
    const start = (cookie, headers = {}) => fetch(webOrigin + "/api/github/connections/start", { method: "POST", headers: { Cookie: cookie, Origin: webOrigin, "x-devfield-csrf": token, ...headers }, redirect: "manual" });
    const baseCookie = `DF_WEB_SESSION_DEV=alice; ${csrfCookie}`;
    assert.equal((await start(baseCookie, { Origin: "https://evil.example" })).status, 403);
    assert.equal((await start("DF_WEB_SESSION_DEV=alice")).status, 403);
    badUrl = true; assert.equal((await start(baseCookie)).status, 503); badUrl = false;
    expired = true; assert.equal((await start(baseCookie)).status, 503); expired = false;
    const started = await start(baseCookie); assert.equal(started.status, 200);
    const attemptCookie = started.headers.get("set-cookie").split(";")[0];
    assert.match(attemptCookie, /^DF_GITHUB_ATTEMPT_DEV=/);
    assert.doesNotMatch(JSON.stringify(await started.json()), /proof|jwt|must-not-leak/);
    const callback = (query, cookie) => get(`/api/github/connections/callback?${query}`, cookie);
    const attemptSession = `${baseCookie}; ${attemptCookie}`;
    const validQuery = `code=abc&state=${proof}&iss=${encodeURIComponent("https://github.com/login/oauth")}`;
    assert.match((await callback("error=access_denied", attemptSession)).headers.get("location"), /\/app\/repoq\/settings\/github\?result=cancelled$/);
    for (const query of [
      `code=abc&state=${proof}&iss=${encodeURIComponent("https://evil.example/oauth")}`,
      `${validQuery}&iss=${encodeURIComponent("https://github.com/login/oauth")}`,
      `code=abc&state=${proof}&iss=`,
      `code=abc&iss=${encodeURIComponent("https://github.com/login/oauth")}`,
      `${validQuery}&unexpected=1`,
    ]) assert.match((await callback(query, attemptSession)).headers.get("location"), /result=failed$/);
    assert.equal(calls.filter(x => x.path === "/api/github/connections/callback/complete").length, 0);
    assert.match((await callback(validQuery, baseCookie)).headers.get("location"), /\/app\/repoq\/settings\/github\?result=expired$/);
    const forged = await callback(`code=abc&state=${"x".repeat(43)}`, attemptSession);
    assert.match(forged.headers.get("location") ?? `${forged.status}: ${await forged.text()} ${nextErrors}`, /result=expired$/);
    assert.equal(calls.filter(x => x.path === "/api/github/connections/callback/complete").length, 0);
    assert.match((await callback(`code=abc&state=${proof}`, `DF_WEB_SESSION_DEV=bob; ${attemptCookie}`)).headers.get("location"), /result=expired$/);
    assert.match((await callback(`code=abc&state=${proof}`, `${baseCookie}; ${attemptCookie.slice(0, -1)}x`)).headers.get("location"), /result=expired$/);
    assert.equal(calls.filter(x => x.path === "/api/github/connections/callback/complete").length, 0);
    shortExpiry = true;
    const shortAttempt = await start(baseCookie), shortCookie = shortAttempt.headers.get("set-cookie").split(";")[0];
    shortExpiry = false;
    await delay(850);
    assert.match((await callback(validQuery, `${baseCookie}; ${shortCookie}`)).headers.get("location"), /result=expired$/);
    for (const failure of [{ status: 400, code: "invalid_request" }, { status: 401, code: "invalid_session" },
      { status: 403, code: "github_attempt_invalid" }, { status: 503, code: "github_unavailable" }]) {
      callbackFailure = failure;
      const failed = await callback(validQuery, attemptSession);
      assert.match(failed.headers.get("location"), new RegExp(`/app/repoq/settings/github\\?result=${failure.status === 403 ? "expired" : "failed"}$`));
      assert.match(failed.headers.get("set-cookie") ?? "", /DF_GITHUB_ATTEMPT_DEV=;/);
    }
    callbackFailure = null;
    const completed = await callback(validQuery, attemptSession);
    assert.match(completed.headers.get("location"), /result=authorized$/);
    assert.match(completed.headers.get("location"), /\/app\/repoq\/settings\/github\?result=authorized$/);
    assert.match(completed.headers.get("set-cookie") ?? "", /DF_GITHUB_ATTEMPT_DEV=;/);
    assert.doesNotMatch(completed.headers.get("location"), /code=|state=|iss=|jwt/);
    assert.match((await callback(`code=abc&state=${proof}`, baseCookie)).headers.get("location"), /result=expired$/);
    assert.match((await callback(`code=abc&state=${proof}`, attemptSession)).headers.get("location"), /result=expired$/);
    assert.deepEqual(calls.filter(x => x.path === "/api/github/connections/callback/complete").map(x => x.input), Array.from({ length: 6 }, () => ({ code: "abc", proof })));
    action = "INSTALL_APP";
    const installed = await start(baseCookie); const installCookie = installed.headers.get("set-cookie").split(";")[0];
    assert.match((await get("/api/github/connections/setup?installation_id=0&setup_action=install", `${baseCookie}; ${installCookie}`)).headers.get("location"), /result=failed$/);
    assert.match((await get("/api/github/connections/setup?installation_id=52&setup_action=install", `${baseCookie}; ${installCookie}`)).headers.get("location"), /result=denied$/);
    const retry = await start(baseCookie); const retryCookie = retry.headers.get("set-cookie").split(";")[0];
    assert.match((await get("/api/github/connections/setup?installation_id=51&setup_action=install", `DF_WEB_SESSION_DEV=bob; ${retryCookie}`)).headers.get("location"), /result=expired$/);
    pending = true;
    const pendingSetup = await get("/api/github/connections/setup?installation_id=51&setup_action=install", `${baseCookie}; ${retryCookie}`);
    assert.match(pendingSetup.headers.get("location"), /\/app\/repoq\/settings\/github\?result=pending$/);
    assert.deepEqual(calls.filter(x => x.path === "/api/github/connections/setup/complete").map(x => x.input), [{ proof, installationId: 52, setupAction: "install" }, { proof, installationId: 51, setupAction: "install" }]);
    assert.deepEqual(await (await get("/api/github/repositories?page=1", "DF_WEB_SESSION_DEV=alice")).json(), { status: "INSTALLATION_PENDING", repositories: [], page: 1, hasNext: false });
    pending = false;
    const repos = await (await get("/api/github/repositories?page=1", "DF_WEB_SESSION_DEV=alice")).json();
    assert.deepEqual(repos.repositories, [{ id: 72, fullName: "org/repo", name: "repo", private: true }]);
    badRepo = true; assert.doesNotMatch(JSON.stringify(await (await get("/api/github/repositories?page=1", "DF_WEB_SESSION_DEV=alice")).json()), /ownerUserId|bob/);
    assert.doesNotMatch(JSON.stringify(await (await get("/api/github/connections", "DF_WEB_SESSION_DEV=alice")).json()), /must-not-leak|token/);
    projectDown = true; assert.equal((await get("/api/github/connections", "DF_WEB_SESSION_DEV=alice")).status, 503);
    projectDown = false; authDown = true; assert.equal((await get("/api/github/connections", "DF_WEB_SESSION_DEV=alice")).status, 503);
    assert.ok(calls.every(x => !x.path.includes("code=") && !x.path.includes("proof=")));
  } finally { next.kill(); await close(auth); await close(project); }
});
