import test from "node:test";
import { consentDecisions } from "../src/app/app/repoq/consents.ts";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const listen = server => new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
const close = server => new Promise(resolve => server.close(resolve));
const proof = "p".repeat(43);
const connectionId = "11111111-1111-4111-8111-111111111111";
const body = request => new Promise(resolve => { let raw = ""; request.on("data", chunk => raw += chunk); request.on("end", () => resolve(raw ? JSON.parse(raw) : {})); });

test("GitHub App BFF binds the attempt to the session and validates Project responses", { timeout: 120000 }, async () => {
  let action = "AUTHORIZE_USER", badUrl = false, expired = false, shortExpiry = false, pending = false, badRepo = false, projectDown = false, authDown = false, callbackConsumed = false, callbackFailure = null, disconnected = false, consentVersion = "test-v1", badConsent = false, badDisconnect = false, badRevocation = false, noConnection = false, badConnection = false, githubAccess = true, cleanupState = "NO_DERIVED_DATA";
  const consentState = {
    PRIVATE_COLLECTION: { purpose: "PRIVATE_COLLECTION", decision: null, policyVersion: null, cleanupState: null },
    EXTERNAL_AI: { purpose: "EXTERNAL_AI", decision: null, policyVersion: null, cleanupState: null },
  };
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
      return res.end(JSON.stringify({ userAuthorization: "AUTHORIZED", installation: "NOT_INSTALLED", connectionId }));
    }
    if (req.url === "/api/github/connections/setup/complete") {
      if (input.installationId !== 51) return res.writeHead(403).end(JSON.stringify({ code: "github_installation_unavailable" }));
      return res.end(JSON.stringify({ userAuthorization: "AUTHORIZED", installation: pending ? "PENDING_APPROVAL" : "INSTALLED", connectionId }));
    }
    if (req.url === "/api/github/connections") return res.end(JSON.stringify({ userAuthorization: disconnected ? "DISCONNECTED" : "AUTHORIZED", installation: disconnected ? "NOT_INSTALLED" : pending ? "PENDING_APPROVAL" : "INSTALLED", connectionId: badConnection ? "invalid" : noConnection ? null : connectionId, token: "must-not-leak" }));
    if (req.url === `/api/github/connections/${connectionId}` && req.method === "DELETE") { if (badDisconnect) return res.writeHead(202).end(JSON.stringify({ connectionId, status: "WRONG" })); disconnected = true; return res.writeHead(202).end(JSON.stringify({ connectionId, status: "BLOCKED", token: "must-not-leak" })); }
    if (req.url === "/api/github/repositories/72/consents") {
      if (req.method === "GET") return res.end(JSON.stringify(badConsent ? { githubRepositoryId: "72", currentPolicyVersion: "test-v1", consentSubmissionAvailable: true, consents: [] } : {
        githubRepositoryId: "72", currentPolicyVersion: consentVersion, consentSubmissionAvailable: !!consentVersion,
        consents: Object.values(consentState), token: "must-not-leak" }));
      if (req.method === "PUT") {
        if (badRevocation) return res.writeHead(202).end(JSON.stringify({ revocationId: null, status: "BLOCKED" }));
        if (input.consents.length === 1 && input.consents[0].decision !== "REVOKED") return res.writeHead(400).end(JSON.stringify({ code: "invalid_request" }));
        let revoked = false;
        for (const consent of input.consents) {
          const previous = consentState[consent.purpose];
          if (consent.decision === "REVOKED") {
            if (!["GRANTED", "REVOKED"].includes(previous.decision)) return res.writeHead(403).end(JSON.stringify({ code: "consent_not_owned" }));
            revoked = true;
            consentState[consent.purpose] = { ...previous, decision: "REVOKED", cleanupState };
          } else if (consent.decision !== previous.decision || consent.policyVersion !== previous.policyVersion) {
            if (consent.policyVersion !== consentVersion || !consentVersion) return res.writeHead(400).end(JSON.stringify({ code: "invalid_request" }));
            if (consent.decision === "GRANTED" && previous.decision === "REVOKED" && previous.cleanupState !== "NO_DERIVED_DATA") return res.writeHead(409).end(JSON.stringify({ code: "revocation_in_progress" }));
            if (consent.decision === "GRANTED" && !githubAccess) return res.writeHead(403).end(JSON.stringify({ code: "github_access_denied" }));
            consentState[consent.purpose] = { ...previous, decision: consent.decision, policyVersion: consent.policyVersion, cleanupState: null };
          }
        }
        return res.writeHead(revoked ? 202 : 200).end(JSON.stringify({ revocationId: revoked ? connectionId : null, status: revoked ? "BLOCKED" : "UPDATED" }));
      }
    }
    if (req.url?.startsWith("/api/github/repositories")) return res.end(JSON.stringify({ status: pending ? "INSTALLATION_PENDING" : "CONNECTED", page: 1, hasNext: false, repositories: pending ? [] : [{ id: 72, fullName: "org/repo", name: "repo", isPrivate: true, ownerUserId: badRepo ? "bob" : undefined }] }));
    res.writeHead(404).end(JSON.stringify({ code: "not_found" }));
  });
  const authPort = await listen(auth), projectPort = await listen(project);
  const probe = createServer(), webPort = await listen(probe); await close(probe);
  webOrigin = `http://127.0.0.1:${webPort}`;
  const next = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", String(webPort), "-H", "127.0.0.1"], { cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: "development", WEB_PUBLIC_ORIGIN: webOrigin, AUTH_INTERNAL_URL: `http://127.0.0.1:${authPort}`, PROJECT_INTERNAL_URL: `http://127.0.0.1:${projectPort}`, WEB_CSRF_SECRET: "isolated-test-secret-at-least-32-characters", DEVFIELD_BFF_SERVICE_KEY: "test-key", WEB_PRIVATE_REGISTRATION_ENABLED: "true" }, stdio: ["ignore", "ignore", "pipe"] });
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
    const connection = await (await get("/api/github/connections", "DF_WEB_SESSION_DEV=alice")).json();
    assert.equal(connection.connectionId, connectionId);
    noConnection = true;
    assert.equal((await (await get("/api/github/connections", "DF_WEB_SESSION_DEV=alice")).json()).connectionId, null);
    noConnection = false;
    badConnection = true; assert.equal((await get("/api/github/connections", "DF_WEB_SESSION_DEV=alice")).status, 503); badConnection = false;
    assert.equal((await get("/api/github/repositories/abc/consents", "DF_WEB_SESSION_DEV=alice")).status, 400);
    const consentPath = "/api/github/repositories/72/consents";
    const initial = await (await get(consentPath, "DF_WEB_SESSION_DEV=alice")).json();
    assert.deepEqual(initial.consents.map(x => x.decision), [null, null]);
    assert.deepEqual(initial.consents.map(x => x.cleanupState), [null, null]);
    assert.doesNotMatch(JSON.stringify(initial), /must-not-leak/);
    consentState.PRIVATE_COLLECTION = { ...consentState.PRIVATE_COLLECTION, cleanupState: "PENDING" };
    assert.equal((await get(consentPath, "DF_WEB_SESSION_DEV=alice")).status, 503);
    consentState.PRIVATE_COLLECTION = { ...consentState.PRIVATE_COLLECTION, cleanupState: null };
    badConsent = true; assert.equal((await get(consentPath, "DF_WEB_SESSION_DEV=alice")).status, 503); badConsent = false;
    const put = (path, input, headers = {}) => fetch(webOrigin + path, { method: "PUT", headers: { Cookie: baseCookie, Origin: webOrigin,
      "x-devfield-csrf": token, "Content-Type": "application/json", ...headers }, body: JSON.stringify(input) });
    const decisions = { consents: [{ purpose: "PRIVATE_COLLECTION", decision: "GRANTED", policyVersion: "test-v1" }, { purpose: "EXTERNAL_AI", decision: "DENIED", policyVersion: "test-v1" }] };
    assert.equal((await put(consentPath, decisions, { Origin: "https://evil.example" })).status, 403);
    assert.equal((await put(consentPath, decisions, { "x-devfield-csrf": "bad" })).status, 403);
    assert.equal((await put(consentPath, { consents: [decisions.consents[0], decisions.consents[0]] })).status, 400);
    assert.equal((await put(consentPath, { consents: [decisions.consents[0]] })).status, 400);
    assert.equal((await put(consentPath, decisions)).status, 200);
    badRevocation = true; assert.equal((await put(consentPath, decisions)).status, 503); badRevocation = false;
    assert.equal((await get(consentPath, "DF_WEB_SESSION_DEV=alice")).status, 200);
    assert.equal((await put(consentPath, { consents: [decisions.consents[0], { ...decisions.consents[1], decision: "GRANTED" }] })).status, 200);
    consentVersion = null;
    assert.equal((await (await get(consentPath, "DF_WEB_SESSION_DEV=alice")).json()).consentSubmissionAvailable, false);
    assert.equal((await put(consentPath, { consents: [decisions.consents[0], { ...decisions.consents[1], decision: "GRANTED", policyVersion: "test-v2" }] })).status, 409);
    const revokeAi = { consents: [{ purpose: "EXTERNAL_AI", decision: "REVOKED", policyVersion: null }] };
    assert.equal((await put(consentPath, revokeAi)).status, 202);
    assert.equal((await put(consentPath, revokeAi)).status, 202);
    let saved = await (await get(consentPath, "DF_WEB_SESSION_DEV=alice")).json();
    assert.equal(saved.consents[0].decision, "GRANTED");
    assert.equal(saved.consents[0].policyVersion, "test-v1");
    assert.equal(saved.consents[1].cleanupState, "NO_DERIVED_DATA");
    assert.deepEqual(calls.filter(x => x.path === consentPath && x.input.consents?.length === 1).map(x => x.input), [revokeAi, revokeAi]);
    cleanupState = "PENDING"; githubAccess = false;
    const revokeCollection = { consents: [{ purpose: "PRIVATE_COLLECTION", decision: "REVOKED", policyVersion: null }] };
    assert.equal((await put(consentPath, revokeCollection)).status, 202);
    saved = await (await get(consentPath, "DF_WEB_SESSION_DEV=alice")).json();
    assert.equal(saved.consents[0].cleanupState, "PENDING");
    assert.equal(saved.consents[1].decision, "REVOKED");
    consentVersion = "test-v2";
    const reconsent = { consents: [{ purpose: "PRIVATE_COLLECTION", decision: "GRANTED", policyVersion: "test-v2" }, { purpose: "EXTERNAL_AI", decision: "REVOKED", policyVersion: null }] };
    assert.equal((await put(consentPath, reconsent)).status, 409);
    consentState.PRIVATE_COLLECTION = { ...consentState.PRIVATE_COLLECTION, cleanupState: "NO_DERIVED_DATA" };
    assert.equal((await put(consentPath, reconsent)).status, 403);
    githubAccess = true;
    assert.equal((await put(consentPath, reconsent)).status, 202);
    saved = await (await get(consentPath, "DF_WEB_SESSION_DEV=alice")).json();
    assert.equal(saved.consents[0].decision, "GRANTED");
    assert.equal(saved.consents[0].policyVersion, "test-v2");
    assert.equal(saved.consents[1].decision, "REVOKED");
    assert.equal(saved.consents[1].policyVersion, "test-v1");
    consentState.EXTERNAL_AI = { ...consentState.EXTERNAL_AI, cleanupState: "NO_DERIVED_DATA" };
    consentVersion = "test-v3";
    saved = await (await get(consentPath, "DF_WEB_SESSION_DEV=alice")).json();
    const renewed = { consents: consentDecisions(saved, "GRANTED", "GRANTED") };
    assert.equal((await put(consentPath, renewed)).status, 200);
    saved = await (await get(consentPath, "DF_WEB_SESSION_DEV=alice")).json();
    assert.deepEqual(saved.consents.map(c => [c.decision, c.policyVersion, c.cleanupState]),
      [["GRANTED", "test-v3", null], ["GRANTED", "test-v3", null]]);
    assert.deepEqual(calls.filter(c => c.path === consentPath && c.input.consents).at(-1).input, renewed);
    const disconnect = (path, headers = {}) => fetch(webOrigin + path, { method: "DELETE", headers: { Cookie: baseCookie, Origin: webOrigin, "x-devfield-csrf": token, ...headers } });
    assert.equal((await disconnect(`/api/github/connections/${connectionId}`, { Origin: "https://evil.example" })).status, 403);
    assert.equal((await disconnect("/api/github/connections/not-a-uuid")).status, 400);
    badDisconnect = true; assert.equal((await disconnect(`/api/github/connections/${connectionId}`)).status, 503); badDisconnect = false;
    assert.equal((await disconnect(`/api/github/connections/${connectionId}`)).status, 202);
    assert.equal((await disconnect(`/api/github/connections/${connectionId}`)).status, 202);
    assert.equal((await (await get("/api/github/connections", "DF_WEB_SESSION_DEV=alice")).json()).userAuthorization, "DISCONNECTED");
    projectDown = true; assert.equal((await get("/api/github/connections", "DF_WEB_SESSION_DEV=alice")).status, 503);
    projectDown = false; authDown = true; assert.equal((await get("/api/github/connections", "DF_WEB_SESSION_DEV=alice")).status, 503);
    assert.ok(calls.every(x => !x.path.includes("code=") && !x.path.includes("proof=")));
  } finally { next.kill(); await close(auth); await close(project); }
});
