import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const listen = server => new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
const close = server => new Promise(resolve => server.close(resolve));
const profile = (providers = [], overrides = {}) => ({
  userId: "00000000-0000-4000-8000-000000000001", displayName: "테스트 사용자", email: "verified@example.test",
  emailLoginEnabled: true, socialProviders: providers, createdAt: "2026-01-02T03:04:05Z", deletionStatus: "NONE", ...overrides,
});

test("account BFF and existing auth regressions against isolated Auth mock", { timeout: 120000 }, async () => {
  const calls = [];
  let releaseSlow;
  const auth = createServer(async (req, res) => {
    calls.push({ path: req.url, method: req.method, handle: req.headers["x-devfield-session-handle"], key: req.headers["x-devfield-service-key"] });
    res.setHeader("Content-Type", "application/json");
    if (req.headers["x-devfield-service"] !== "bff" || req.headers["x-devfield-service-key"] !== "isolated-test-key") { res.writeHead(403).end(); return; }
    const handle = req.headers["x-devfield-session-handle"];
    if (req.url === "/internal/auth/oauth-intents" && req.method === "POST") {
      const body = JSON.parse(await new Promise(resolve => { let raw = ""; req.on("data", chunk => raw += chunk); req.on("end", () => resolve(raw)); }));
      if (!["LOGIN_COMPLETE", "SIGNUP_COMPLETE"].includes(body.returnRoute)) { res.writeHead(400).end(JSON.stringify({ code: "invalid_oauth_intent" })); return; }
      res.writeHead(201).end(JSON.stringify({ authorizationUrl: `http://127.0.0.1:18080/oauth2/authorization/${body.provider}?intent=${"i".repeat(43)}` })); return;
    }
    if (req.url === "/internal/auth/oauth-handoffs/exchange" && req.method === "POST") {
      const body = JSON.parse(await new Promise(resolve => { let raw = ""; req.on("data", chunk => raw += chunk); req.on("end", () => resolve(raw)); }));
      const outcome = body.expectedPurpose === "LOGIN" ? "SIGNUP_REQUIRED" : "EXISTING_ACCOUNT";
      res.writeHead(200).end(JSON.stringify({ sessionHandle: null, userId: null, returnRoute: `${body.expectedPurpose}_COMPLETE`, outcome })); return;
    }
    if (req.url === "/api/account/me" && req.method === "GET") {
      res.setHeader("Cache-Control", "no-store");
      if (handle === "slow") { releaseSlow = () => res.writeHead(200).end(JSON.stringify(profile())); return; }
      if (handle === "unavailable") { res.writeHead(503).end(JSON.stringify({ code: "auth_unavailable", secret: "must-not-leak" })); return; }
      if (handle === "forbidden") { res.writeHead(403).end(JSON.stringify({ code: "account_unavailable" })); return; }
      if (["expired", "revoked"].includes(handle)) { res.writeHead(401).end(JSON.stringify({ code: "invalid_session" })); return; }
      const data = handle === "github" ? profile(["GITHUB"], { email: null, emailLoginEnabled: false, displayName: null })
        : handle === "google-kakao" ? profile(["GOOGLE", "KAKAO"], { email: null, emailLoginEnabled: false })
        : handle === "deleting" ? profile([], { deletionStatus: "DELETING" }) : profile();
      res.writeHead(200).end(JSON.stringify({ ...data, sessionHandle: "must-not-leak", jwt: "must-not-leak", secret: "must-not-leak" })); return;
    }
    if (req.url === "/internal/auth/session-token" && req.method === "POST") {
      if (handle === "deleting" || handle === "forbidden") { res.writeHead(403).end(JSON.stringify({ code: "session_unavailable" })); return; }
      if (handle === "email") { res.writeHead(200).end(JSON.stringify({ jwt: "fake-jwt" })); return; }
      res.writeHead(401).end(JSON.stringify({ code: "invalid_session" })); return;
    }
    if (req.url === "/api/auth/logout" && req.method === "POST") { res.writeHead(204).end(); return; }
    if (req.url === "/api/account/reauth/password" && req.method === "POST") {
      if (handle !== "email") { res.writeHead(401).end(JSON.stringify({ code: "invalid_session" })); return; }
      res.writeHead(200).end(JSON.stringify({ reauthProof: "r".repeat(43) })); return;
    }
    if (req.url === "/api/account/social-links/google" && req.method === "POST") {
      if (handle !== "email") { res.writeHead(401).end(JSON.stringify({ code: "invalid_session" })); return; }
      res.writeHead(201).end(JSON.stringify({ authorizationUrl: `http://127.0.0.1:18080/oauth2/authorization/google?intent=${"i".repeat(43)}` })); return;
    }
    if (req.url === "/api/account/social-links/google" && req.method === "DELETE") { res.writeHead(204).end(); return; }
    res.writeHead(404).end(JSON.stringify({ code: "not_found" }));
  });
  const authPort = await listen(auth);
  const probe = createServer();
  const webPort = await listen(probe);
  await close(probe);
  const origin = `http://127.0.0.1:${webPort}`;
  const next = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", String(webPort), "-H", "127.0.0.1"], {
    cwd: process.cwd(), env: { ...process.env, NODE_ENV: "development", WEB_PUBLIC_ORIGIN: origin,
      AUTH_INTERNAL_URL: `http://127.0.0.1:${authPort}`, DEVFIELD_BFF_SERVICE_KEY: "isolated-test-key",
      WEB_CSRF_SECRET: "isolated-test-secret-at-least-32-characters", WEB_ENABLED_OAUTH_PROVIDERS: "google,github,kakao" }, stdio: "ignore",
  });
  try {
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(`${origin}/api/health`)).ok) { ready = true; break; } } catch {}
      if (next.exitCode !== null) break;
      await delay(250);
    }
    assert.ok(ready, "Next server should start");
    const get = (path, handle, options = {}) => fetch(`${origin}${path}`, { headers: handle ? { Cookie: `DF_WEB_SESSION_DEV=${handle}`, ...options.headers } : options.headers, redirect: "manual", ...options });
    const missing = await get("/api/account/me");
    assert.equal(missing.status, 401);
    assert.deepEqual(await missing.json(), { code: "invalid_session" });
    for (const [handle, expected] of [["email", []], ["github", ["GITHUB"]], ["google-kakao", ["GOOGLE", "KAKAO"]], ["deleting", []]]) {
      const response = await get("/api/account/me", handle);
      assert.equal(response.status, 200);
      assert.match(response.headers.get("cache-control") ?? "", /no-store/);
      const body = await response.json();
      assert.deepEqual(body.socialProviders, expected);
      assert.equal(body.deletionStatus, handle === "deleting" ? "DELETING" : "NONE");
      assert.equal(body.displayName, handle === "github" ? null : "테스트 사용자");
      assert.equal(body.email, handle === "github" || handle === "google-kakao" ? null : "verified@example.test");
      assert.deepEqual(Object.keys(body).sort(), ["userId", "displayName", "email", "emailLoginEnabled", "socialProviders", "createdAt", "deletionStatus"].sort());
      assert.doesNotMatch(JSON.stringify(body), /must-not-leak|jwt|sessionHandle|secret/);
    }
    for (const handle of ["expired", "revoked"]) assert.equal((await get("/api/account/me", handle)).status, 401);
    assert.equal((await get("/api/account/me?userId=00000000-0000-4000-8000-000000000002", "email")).status, 400);
    const failed = await get("/api/account/me", "unavailable");
    assert.equal(failed.status, 503);
    assert.deepEqual(await failed.json(), { code: "auth_unavailable" });
    assert.match(failed.headers.get("cache-control") ?? "", /no-store/);
    assert.equal(failed.headers.get("set-cookie"), null);
    assert.equal((await get("/api/account/me", "forbidden")).status, 403);
    assert.equal((await get("/app", "deleting")).status, 200);
    assert.match(await (await get("/app", "deleting")).text(), /계정을 이용할 수 없습니다/);
    assert.equal((await get("/account", "deleting")).status, 200);
    assert.match(await (await get("/account", "deleting")).text(), /계정 삭제가 진행 중입니다/);
    const anonymousPage = await get("/account");
    assert.ok([200, 307].includes(anonymousPage.status));
    if (anonymousPage.status === 200) assert.match(await anonymousPage.text(), /\/login/);
    const unavailablePage = await get("/account", "unavailable");
    assert.match(unavailablePage.headers.get("cache-control") ?? "", /no-store/);
    assert.equal(unavailablePage.headers.get("set-cookie"), null);
    assert.doesNotMatch(await unavailablePage.text(), /verified@example.test|must-not-leak/);
    const account = await get("/account", "github");
    const html = await account.text();
    assert.match(html, /등록된 표시 이름이 없습니다/);
    assert.match(html, /등록된 이메일 로그인 정보가 없습니다/);
    assert.match(html, /GitHub/);
    assert.match(html, /github-invertocat-white\.svg/);
    assert.match(html, /마지막 로그인 수단은 해제할 수 없습니다/);
    assert.match(html, /ACCOUNT \/ OVERVIEW/);
    assert.match(html, /DevField User ID 복사/);
    assert.match(html, /aria-live="polite"/);
    assert.match(html, /aria-current="page"[^>]*>내 계정/);
    assert.doesNotMatch(html, /must-not-leak|fake-jwt/);
    for (const [path, prompt] of [["/login", "계정이 없나요?"], ["/login/email", "계정이 없나요?"],
      ["/signup", "이미 계정이 있나요?"], ["/signup/email", "이미 계정이 있나요?"]]) {
      const screen = await get(path);
      assert.equal(screen.status, 200);
      assert.match(await screen.text(), new RegExp(prompt.replace(/[?]/g, "\\?")));
    }
    const loadingResponse = await get("/account", "slow");
    const stream = loadingResponse.body.getReader();
    const first = await stream.read();
    const skeleton = new TextDecoder().decode(first.value);
    assert.match(skeleton, /계정 정보를 불러오는 중입니다/);
    assert.doesNotMatch(skeleton, /verified@example.test/);
    assert.equal(typeof releaseSlow, "function");
    releaseSlow();
    let completed = skeleton;
    while (true) { const chunk = await stream.read(); if (chunk.done) break; completed += new TextDecoder().decode(chunk.value); }
    assert.match(completed, /verified@example.test/);
    const csrf = await get("/api/auth/csrf", "email");
    const csrfCookie = csrf.headers.get("set-cookie")?.split(";")[0];
    const { token } = await csrf.json();
    const accountHeaders = { Origin: origin, Cookie: `DF_WEB_SESSION_DEV=email; ${csrfCookie}`, "X-DevField-CSRF": token };
    const noCsrf = await fetch(`${origin}/api/account/reauth/password`, { method: "POST", headers: { Origin: origin,
      Cookie: `DF_WEB_SESSION_DEV=email; ${csrfCookie}`, "Content-Type": "application/json" }, body: JSON.stringify({ password: "safe-password" }) });
    assert.equal(noCsrf.status, 403);
    const reauth = await fetch(`${origin}/api/account/reauth/password`, { method: "POST", headers: { ...accountHeaders,
      "Content-Type": "application/json" }, body: JSON.stringify({ password: "safe-password" }) });
    assert.equal(reauth.status, 200);
    assert.deepEqual(await reauth.json(), { reauthenticated: true });
    const reauthCookie = reauth.headers.get("set-cookie")?.split(";")[0];
    assert.match(reauthCookie ?? "", /^DF_ACCOUNT_REAUTH=/);
    const reauthStatus = await fetch(`${origin}/api/account/reauth/status`, { headers: { Cookie: `${accountHeaders.Cookie}; ${reauthCookie}` } });
    assert.equal(reauthStatus.status, 200);
    assert.deepEqual(await reauthStatus.json(), { reauthenticated: true });
    assert.deepEqual(await (await get("/api/account/reauth/status", "email")).json(), { reauthenticated: false });
    const link = await fetch(`${origin}/api/account/social-links/google`, { method: "POST", headers: { ...accountHeaders,
      Cookie: `${accountHeaders.Cookie}; ${reauthCookie}`, "Content-Type": "application/json" }, body: "{}" });
    assert.equal(link.status, 200);
    assert.match((await link.json()).authorizationUrl, /oauth2\/authorization\/google/);
    assert.ok(!calls.some(call => call.path?.includes("password=") || call.path?.includes("reauthProof=")));
    const logout = await fetch(`${origin}/api/auth/logout`, { method: "POST", headers: { Origin: origin,
      Cookie: `DF_WEB_SESSION_DEV=email; ${csrfCookie}`, "X-DevField-CSRF": token, "Content-Type": "application/json" }, body: "{}" });
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get("set-cookie") ?? "", /DF_WEB_SESSION_DEV=;.*Expires=Thu, 01 Jan 1970/i);
    assert.equal((await get("/api/account/me")).status, 401);
    assert.ok(calls.filter(call => call.path === "/api/account/me").every(call => call.key === "isolated-test-key" && call.method === "GET"));
    assert.ok(!calls.some(call => call.path?.includes("userId=")));
    const anonymousCsrf = await get("/api/auth/csrf");
    const anonymousCookie = anonymousCsrf.headers.get("set-cookie")?.split(";")[0];
    const { token: anonymousToken } = await anonymousCsrf.json();
    for (const [intent, outcome] of [["LOGIN", "SIGNUP_REQUIRED"], ["SIGNUP", "EXISTING_ACCOUNT"]]) {
      const headers = { Origin: origin, Cookie: anonymousCookie, "X-DevField-CSRF": anonymousToken, "Content-Type": "application/json" };
      const started = await fetch(`${origin}/api/auth/oauth/start`, { method: "POST", headers, body: JSON.stringify({ provider: "google", intent }) });
      assert.equal(started.status, 200);
      const bindingCookie = started.headers.get("set-cookie")?.split(";")[0];
      assert.match(bindingCookie ?? "", new RegExp(`\\.${intent}$`));
      const flowId = bindingCookie.match(/^DF_OAUTH_([A-Za-z0-9_-]{43})=/)?.[1];
      assert.ok(flowId);
      const completed = await fetch(`${origin}/api/auth/oauth/complete`, { method: "POST", headers: { ...headers, Cookie: `${anonymousCookie}; ${bindingCookie}` },
        body: JSON.stringify({ flowId, handoff: "h".repeat(43) }) });
      assert.equal(completed.status, 200);
      assert.deepEqual(await completed.json(), { authenticated: false, outcome });
      assert.doesNotMatch(completed.headers.get("set-cookie") ?? "", /DF_WEB_SESSION_DEV=/);
    }
    const regression = spawn(process.execPath, ["--test", "tests/auth-bff-http.test.mjs"], { cwd: process.cwd(),
      env: { ...process.env, WEB_TEST_ORIGIN: origin }, stdio: "pipe" });
    let output = "";
    for await (const chunk of regression.stdout) output += chunk;
    for await (const chunk of regression.stderr) output += chunk;
    const code = await new Promise(resolve => regression.on("close", resolve));
    assert.equal(code, 0, output);
  } finally { next.kill(); await close(auth); }
});
