import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const listen = server => new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
const close = server => new Promise(resolve => server.close(resolve));
const profile = (providers = [], overrides = {}) => ({
  userId: "00000000-0000-4000-8000-000000000001", displayName: "테스트 사용자", email: "verified@example.test",
  emailLoginEnabled: true, emailLoginPending: false, emailOwnershipVerified: true, socialProviders: providers, createdAt: "2026-01-02T03:04:05Z", deletionStatus: "NONE", ...overrides,
});

test("account BFF and existing auth regressions against isolated Auth mock", { timeout: 120000 }, async () => {
  const calls = [];
  let releaseSlow;
  let timeoutAccepted = false;
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
      if (body.expectedPurpose === "ACCOUNT") {
        res.writeHead(200).end(JSON.stringify({ returnRoute: "REAUTH_COMPLETE", reauthProof: "r".repeat(43) })); return;
      }
      const outcome = body.expectedPurpose === "LOGIN" ? "SIGNUP_REQUIRED" : "EXISTING_ACCOUNT";
      res.writeHead(200).end(JSON.stringify({ sessionHandle: null, userId: null, returnRoute: `${body.expectedPurpose}_COMPLETE`, outcome })); return;
    }
    if (req.url === "/api/account/me" && req.method === "DELETE") {
      const raw = await new Promise(resolve => { let body = ""; req.on("data", chunk => body += chunk); req.on("end", () => resolve(body)); });
      calls.at(-1).body = raw ? JSON.parse(raw) : undefined;
      if (handle === "bad-service") { res.writeHead(401).end(); return; }
      if (handle === "revoked") { res.writeHead(401).end(JSON.stringify({ code: "invalid_session" })); return; }
      if (handle === "completed") { res.writeHead(204).end(); return; }
      if (handle === "bad-delete-dto") { res.writeHead(202).end(JSON.stringify({ deletionStatus: "NONE" })); return; }
      if (handle === "timeout-deletion") { timeoutAccepted = true; return; }
      if (handle === "uncertain-deletion") { res.destroy(); return; }
      if (handle === "deleting" || calls.at(-1).body?.reauthProof === "r".repeat(43)) {
        res.writeHead(202).end(JSON.stringify({ deletionStatus: "DELETING", secret: "must-not-leak" })); return;
      }
      res.writeHead(403).end(JSON.stringify({ code: "reauth_required" })); return;
    }
    if (req.url === "/api/account/me" && req.method === "GET") {
      res.setHeader("Cache-Control", "no-store");
      if (handle === "slow") { releaseSlow = () => res.writeHead(200).end(JSON.stringify(profile())); return; }
      if (handle === "unavailable") { res.writeHead(503).end(JSON.stringify({ code: "auth_unavailable", secret: "must-not-leak" })); return; }
      if (handle === "forbidden") { res.writeHead(403).end(JSON.stringify({ code: "account_unavailable" })); return; }
      if (handle === "bad-service") { res.writeHead(401).end(); return; }
      if (["expired", "revoked"].includes(handle)) { res.writeHead(401).end(JSON.stringify({ code: "invalid_session" })); return; }
      const data = handle === "github" ? profile(["GITHUB"], { email: null, emailLoginEnabled: false, displayName: null })
        : handle === "google-kakao" ? profile(["GOOGLE", "KAKAO"], { email: null, emailLoginEnabled: false })
        : handle === "deleting" || (handle === "timeout-deletion" && timeoutAccepted) ? profile([], { deletionStatus: "DELETING" }) : profile();
      if (handle === "second-account") data.userId = "00000000-0000-4000-8000-000000000002";
      res.writeHead(200).end(JSON.stringify({ ...data, sessionHandle: "must-not-leak", jwt: "must-not-leak", secret: "must-not-leak" })); return;
    }
    if (req.url === "/internal/auth/session-token" && req.method === "POST") {
      if (handle === "deleting" || handle === "forbidden") { res.writeHead(403).end(JSON.stringify({ code: "session_unavailable" })); return; }
      if (["email", "second-account"].includes(handle)) { res.writeHead(200).end(JSON.stringify({ jwt: "fake-jwt" })); return; }
      res.writeHead(401).end(JSON.stringify({ code: "invalid_session" })); return;
    }
    if (req.url === "/api/auth/logout" && req.method === "POST") { res.writeHead(204).end(); return; }
    if (req.url === "/api/account/reauth/password" && req.method === "POST") {
      if (!["email", "second-account"].includes(handle)) { res.writeHead(401).end(JSON.stringify({ code: "invalid_session" })); return; }
      res.writeHead(200).end(JSON.stringify({ reauthProof: "r".repeat(43) })); return;
    }
    if (req.url === "/api/account/reauth/social/google" && req.method === "POST") {
      res.writeHead(201).end(JSON.stringify({ authorizationUrl: `http://127.0.0.1:18080/oauth2/authorization/google?intent=${"i".repeat(43)}` })); return;
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
      assert.deepEqual(Object.keys(body).sort(), ["userId", "displayName", "email", "emailLoginEnabled", "emailLoginPending", "emailOwnershipVerified", "socialProviders", "createdAt", "deletionStatus"].sort());
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
    const deletingPage = await (await get("/account", "deleting")).text();
    assert.match(deletingPage, /계정 삭제가 진행 중입니다/);
    assert.match(deletingPage, /탈퇴 처리 재확인/);
    assert.doesNotMatch(deletingPage, /회원 탈퇴 신청/);
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
    assert.match(html, /회원 탈퇴 신청/);
    assert.doesNotMatch(html, /회원 탈퇴 최종 확인/);
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
    assert.ok(calls.filter(call => call.path === "/api/account/me").every(call => call.key === "isolated-test-key"));
    const makeDeletionHeaders = async (handle, retry = false) => {
      const page = retry ? "" : await (await get("/account", handle)).text();
      const context = page.replaceAll(String.fromCharCode(92), "").match(/"deletionContext":"([A-Za-z0-9_-]{43})"/)?.[1];
      if (!retry) assert.ok(context, "account page should bind the deletion action to the rendered session");
      const seed = await get("/api/auth/csrf", handle);
      const cookie = seed.headers.get("set-cookie")?.split(";")[0];
      return { Origin: origin, Cookie: `DF_WEB_SESSION_DEV=${handle}; ${cookie}`, "X-DevField-CSRF": (await seed.json()).token,
        ...(retry ? { "X-DevField-Deletion-Retry": "1" } : { "X-DevField-Deletion-Context": context }) };
    };
    const deleteAccount = (headers, body, query = "") => fetch(`${origin}/api/account/me${query}`, {
      method: "DELETE", headers, body,
    });
    const deleteCalls = () => calls.filter(call => call.path === "/api/account/me" && call.method === "DELETE");
    const deletionHeaders = await makeDeletionHeaders("email");
    const start = calls.length;
    assert.equal((await deleteAccount({ ...deletionHeaders, Origin: "https://other.example" })).status, 403);
    assert.equal((await deleteAccount({ ...deletionHeaders, "Sec-Fetch-Site": "cross-site" })).status, 403);
    assert.equal((await deleteAccount({ ...deletionHeaders, "X-DevField-CSRF": "invalid" })).status, 403);
    assert.equal((await deleteAccount(deletionHeaders, '{"userId":"other","reauthProof":"forged"}')).status, 400);
    assert.equal((await deleteAccount(deletionHeaders, undefined, "?userId=other")).status, 400);
    assert.equal(calls.length, start);
    const noProof = await deleteAccount(deletionHeaders);
    assert.equal(noProof.status, 403);
    assert.deepEqual(await noProof.json(), { code: "reauth_required" });
    assert.equal(deleteCalls().at(-1).body, undefined);

    // Tab A retains its rendered context while tab B replaces the browser's session and proof.
    const secondHeaders = await makeDeletionHeaders("second-account");
    assert.notEqual(secondHeaders["X-DevField-Deletion-Context"], deletionHeaders["X-DevField-Deletion-Context"]);
    const secondProof = await fetch(`${origin}/api/account/reauth/password`, {
      method: "POST", headers: { ...secondHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ password: "second-password" }),
    });
    assert.equal(secondProof.status, 200);
    const secondCookie = secondProof.headers.getSetCookie().find(cookie => cookie.startsWith("DF_ACCOUNT_REAUTH=")).split(";")[0];
    const beforeStaleTab = calls.length;
    const staleTab = await deleteAccount({
      ...secondHeaders, Cookie: `${secondHeaders.Cookie}; ${secondCookie}`,
      "X-DevField-Deletion-Context": deletionHeaders["X-DevField-Deletion-Context"],
    });
    assert.equal(staleTab.status, 409);
    assert.deepEqual(await staleTab.json(), { code: "account_session_changed" });
    assert.equal(staleTab.headers.get("set-cookie"), null);
    assert.equal(calls.length, beforeStaleTab);
    const currentTab = await deleteAccount({ ...secondHeaders, Cookie: `${secondHeaders.Cookie}; ${secondCookie}` });
    assert.equal(currentTab.status, 202);
    assert.equal(deleteCalls().at(-1).handle, "second-account");

    const startSocialReauth = async () => {
      const response = await fetch(`${origin}/api/account/reauth/social/google`, { method: "POST", headers: deletionHeaders });
      assert.equal(response.status, 200);
      const { flowId } = await response.json();
      assert.match(flowId, /^[A-Za-z0-9_-]{43}$/);
      return { flowId, cookie: response.headers.getSetCookie().find(cookie => cookie.startsWith(`DF_ACCOUNT_OAUTH_${flowId}=`)).split(";")[0] };
    };
    const abandoned = await startSocialReauth();
    const unrelated = await startSocialReauth();
    const socialComplete = await fetch(`${origin}/api/account/oauth/complete`, {
      method: "POST", headers: { ...deletionHeaders, Cookie: `${deletionHeaders.Cookie}; ${unrelated.cookie}`, "Content-Type": "application/json" },
      body: JSON.stringify({ flowId: unrelated.flowId, handoff: "h".repeat(43) }),
    });
    assert.equal(socialComplete.status, 200);
    assert.deepEqual(await socialComplete.json(), { next: `/account?status=reauthenticated&reauthFlow=${unrelated.flowId}` });
    const socialCookies = socialComplete.headers.getSetCookie().filter(cookie => cookie.startsWith("DF_ACCOUNT_REAUTH"))
      .map(cookie => cookie.split(";")[0]).join("; ");
    for (const [flowId, expected] of [[abandoned.flowId, false], [unrelated.flowId, true]]) {
      const status = await fetch(`${origin}/api/account/reauth/status?flowId=${flowId}`,
        { headers: { Cookie: `${deletionHeaders.Cookie}; ${socialCookies}` } });
      assert.deepEqual(await status.json(), { reauthenticated: expected });
    }
    const beforeMismatchedFlow = calls.length;
    const mismatchedFlow = await deleteAccount({ ...deletionHeaders, Cookie: `${deletionHeaders.Cookie}; ${socialCookies}`,
      "X-DevField-Deletion-Reauth-Flow": abandoned.flowId });
    assert.equal(mismatchedFlow.status, 403);
    assert.deepEqual(await mismatchedFlow.json(), { code: "deletion_reauth_flow_changed" });
    assert.equal(calls.length, beforeMismatchedFlow);

    const accepted = await deleteAccount({ ...deletionHeaders, Cookie: `${deletionHeaders.Cookie}; ${socialCookies}`,
      "X-DevField-Deletion-Reauth-Flow": unrelated.flowId });
    assert.equal(accepted.status, 202);
    assert.deepEqual(await accepted.json(), { deletionStatus: "DELETING" });
    assert.deepEqual(deleteCalls().at(-1).body, { reauthProof: "r".repeat(43) });
    assert.match(accepted.headers.get("set-cookie") ?? "", /DF_ACCOUNT_REAUTH=;.*Path=\/api\/account.*Max-Age=0/i);
    assert.doesNotMatch(accepted.headers.get("set-cookie") ?? "", /DF_WEB_SESSION_DEV|DF_CSRF_DEV/);
    assert.match(accepted.headers.get("cache-control") ?? "", /no-store/);

    const retryStart = calls.length;
    const retryHeaders = await makeDeletionHeaders("deleting", true);
    const retry = await deleteAccount({ ...retryHeaders, Cookie: `${retryHeaders.Cookie}; ${reauthCookie}`,
      "X-DevField-Deletion-Retry": "1" });
    assert.equal(retry.status, 202);
    assert.equal(deleteCalls().at(-1).body, undefined);
    assert.deepEqual(calls.slice(retryStart).map(call => [call.method, call.path]), [["DELETE", "/api/account/me"]]);

    for (const [handle, expected] of [["completed", 204], ["revoked", 401], ["bad-service", 503], ["bad-delete-dto", 503]]) {
      const response = await deleteAccount(await makeDeletionHeaders(handle, true));
      assert.equal(response.status, expected);
      const setCookie = response.headers.get("set-cookie") ?? "";
      if (expected === 204 || expected === 401) {
        assert.match(setCookie, /DF_WEB_SESSION_DEV=;/i);
        assert.match(setCookie, /DF_CSRF_DEV=;/i);
        assert.match(setCookie, /DF_ACCOUNT_REAUTH=;[^,]*Path=\/api\/account/i);
        if (expected === 204) assert.equal(await response.text(), "");
        else assert.deepEqual(await response.json(), { code: "invalid_session" });
      } else assert.equal(setCookie, "");
    }
    const revokedStatus = await get("/api/account/me", "revoked");
    assert.equal(revokedStatus.status, 401);
    assert.match(revokedStatus.headers.get("set-cookie") ?? "", /DF_WEB_SESSION_DEV=;/i);

    const uncertainHeaders = await makeDeletionHeaders("uncertain-deletion");
    const uncertainStart = calls.length;
    const uncertain = await deleteAccount(uncertainHeaders);
    assert.equal(uncertain.status, 503);
    assert.equal(uncertain.headers.get("set-cookie"), null);
    assert.deepEqual(calls.slice(uncertainStart).map(call => [call.method, call.path]),
      [["DELETE", "/api/account/me"], ["GET", "/api/account/me"]]);

    const timeoutHeaders = await makeDeletionHeaders("timeout-deletion");
    const beforeTimeout = calls.length;
    const recovered = await deleteAccount(timeoutHeaders);
    assert.equal(recovered.status, 202);
    assert.deepEqual(await recovered.json(), { deletionStatus: "DELETING" });
    assert.doesNotMatch(recovered.headers.get("set-cookie") ?? "", /DF_WEB_SESSION_DEV|DF_CSRF_DEV/);
    assert.deepEqual(calls.slice(beforeTimeout).map(call => [call.method, call.path]),
      [["DELETE", "/api/account/me"], ["GET", "/api/account/me"]]);
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
