import test from "node:test";
import assert from "node:assert/strict";

const origin = process.env.WEB_TEST_ORIGIN ?? "http://localhost:13000";
const url = path => new URL(path, origin);

test("BFF rejects missing or incorrect Origin and CSRF before Auth", async () => {
  const csrf = await fetch(url("/api/auth/csrf"));
  assert.equal(csrf.status, 200);
  assert.match(csrf.headers.get("cache-control") ?? "", /no-store/);
  const cookie = csrf.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  assert.match(csrf.headers.get("set-cookie") ?? "", /HttpOnly/i);
  const { token } = await csrf.json();
  assert.match(token, /^\d+\.[A-Za-z0-9_-]{43}$/);

  const post = (headers, body = "{}") => fetch(url("/api/auth/signup"), {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie, ...headers }, body,
  });
  assert.equal((await post({ "X-DevField-CSRF": token })).status, 403);
  assert.equal((await post({ Origin: "http://127.0.0.1:13000", "X-DevField-CSRF": token })).status, 403);
  assert.equal((await post({ Origin: origin })).status, 403);
  assert.equal((await post({ Origin: origin, "X-DevField-CSRF": "invalid" })).status, 403);
  assert.equal((await post({ Origin: origin, "X-DevField-CSRF": token }, JSON.stringify({ padding: "x".repeat(9000) }))).status, 413);
});

test("anonymous session is rejected without a browser session handle", async () => {
  const response = await fetch(url("/api/auth/session"));
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { code: "invalid_session" });
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
});
