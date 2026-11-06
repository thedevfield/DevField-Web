import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { readyDetail, blockedDetail } from "./fixtures/analysis.mjs";

const require = createRequire(import.meta.url);
function load(path, overrides = {}, globals = {}) {
  const code = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: name => {
    if (name in overrides) return overrides[name];
    if (name.endsWith(".module.css")) return new Proxy({}, { get: (_, key) => String(key) });
    return require(name);
  }, AbortController, AbortSignal, console, ...globals }, { filename: path });
  return exports;
}
class BffError extends Error { constructor(status, code) { super(code); this.status = status; this.code = code; } }
const { detailOf } = load("src/lib/server/repoq.ts", { "server-only": {}, "./auth": { BffError }, "./github": {} });
const { AnalysisSnapshotView } = load("src/app/app/repoq/AnalysisSnapshotView.tsx");
const ui = load("src/app/app/repoq/project-ui.ts");
const rejected = value => assert.throws(() => detailOf(value), e => e.status === 503 && e.code === "project_unavailable");

test("client rejects interrupted or malformed successful JSON instead of retaining a result", async () => {
  await assert.rejects(ui.responseData(new Response("{", { status: 200 })));
  assert.equal(await ui.responseData(new Response(null, { status: 204 })), null);
});
test("P-03 accepts actual single/multi READY and nullable previous-result states", () => {
  for (const count of [1, 2, 20]) {
    const value = readyDetail(count);
    assert.equal(detailOf(value).latestReadySnapshot.members.length, count);
  }
  for (const state of ["QUEUED", "RUNNING", "FAILED", "INSUFFICIENT_EVIDENCE", "CANCELLED"]) {
    const value = readyDetail(); value.analysisStatus = state; value.latestReadySnapshot = null;
    assert.equal(detailOf(value).latestReadySnapshot, null);
    assert.ok(ui.analysisMessage[state]);
  }
  for (const state of ["RUNNING", "FAILED"]) {
    const value = readyDetail(); value.analysisStatus = state;
    value.repositories[0].commitSha = "b".repeat(40); // Current job may differ from a previous snapshot.
    assert.equal(detailOf(value).latestReadySnapshot.members[0].commitSha, "a".repeat(40));
  }
});
test("P-03 rejects malformed fields, identities, references and limits", () => {
  const edits = [
    d => d.latestReadySnapshot = null,
    d => d.latestReadySnapshot.snapshotId = "not-an-id",
    d => d.latestReadySnapshot.members[0].commitSha = "abc",
    d => d.latestReadySnapshot.members[0].repositoryId = readyDetail(2).repositories[1].id,
    d => d.latestReadySnapshot.membershipVersion++,
    d => d.repositories[0].commitSha = "b".repeat(40),
    d => d.latestReadySnapshot.evidenceReferences[0].memberId = d.id,
    d => d.latestReadySnapshot.evidenceReferences[0].commitSha = "b".repeat(40),
    d => d.latestReadySnapshot.evidenceReferences[0].lineStart = 0,
    d => d.latestReadySnapshot.evidenceReferences[0].lineEnd = 2,
    d => d.latestReadySnapshot.evidenceReferences[0].lineEnd = null,
    d => d.latestReadySnapshot.evidenceReferences[0].filePath = "../secret",
    d => d.latestReadySnapshot.evidenceReferences[0].summary = "bad\nsummary",
    d => d.latestReadySnapshot.evidenceReferences[0].claimType = "MADE_UP",
    d => d.latestReadySnapshot.evidenceReferences[0].claimType = "HYPOTHESIS",
    d => d.latestReadySnapshot.evidenceReferences.push(d.latestReadySnapshot.evidenceReferences[0]),
    d => d.latestReadySnapshot.topics = [{ key: "API_BACKEND" }],
    d => d.latestReadySnapshot.topics = [],
    d => d.latestReadySnapshot.topics = Array(65).fill("API_BACKEND"),
    d => d.latestReadySnapshot.members = Array(21).fill(d.latestReadySnapshot.members[0]),
    d => d.latestReadySnapshot.coverage[0].collectedFiles = 41,
    d => d.latestReadySnapshot.coverage[0].exclusions = { unsupported_file: -1 },
    d => d.latestReadySnapshot.coverage[0].selectedPaths = Array(41).fill("A.java"),
    d => d.latestReadySnapshot.coverage[0].memberId = d.id,
    d => d.canInterview = true,
    d => d.canPrivateInterview = true,
    d => d.repositories[0].visibility = "PRIVATE",
  ];
  for (const edit of edits) { const d = readyDetail(); edit(d); rejected(d); }
  for (const key of Object.keys(readyDetail().latestReadySnapshot)) {
    const d = readyDetail(); delete d.latestReadySnapshot[key]; rejected(d);
  }
  for (const key of Object.keys(readyDetail().latestReadySnapshot.evidenceReferences[0])) {
    const d = readyDetail(); delete d.latestReadySnapshot.evidenceReferences[0][key]; rejected(d);
  }
  const duplicate = readyDetail(2); duplicate.repositories[1] = duplicate.repositories[0]; rejected(duplicate);
});
test("relations require both members' evidence and compatible claims", () => {
  const d = readyDetail(2), s = d.latestReadySnapshot;
  s.relations.push({ fromMemberId: s.members[0].memberId, toMemberId: s.members[1].memberId,
    claimType: "CODE_FACT", evidenceIds: [s.evidenceReferences[0].id, s.evidenceReferences[2].id], summary: "Confirmed relation." });
  assert.equal(detailOf(d).latestReadySnapshot.relations.length, 1);
  s.relations[0].evidenceIds.pop(); rejected(d);
  s.relations[0].evidenceIds.push(s.evidenceReferences[3].id); rejected(d);
});
test("protected HTTP-200 DTO is accepted but leaked fields or snapshot are rejected", () => {
  assert.equal(detailOf(blockedDetail()).latestReadySnapshot, null);
  for (const key of ["githubRepositoryId", "fullName", "commitSha"]) {
    const d = blockedDetail(); d.repositories[0][key] = readyDetail().repositories[0][key]; rejected(d);
  }
  const d = blockedDetail(); d.latestReadySnapshot = readyDetail().latestReadySnapshot; rejected(d);
  const clean = readyDetail(); clean.latestReadySnapshot.token = "SECRET"; clean.latestReadySnapshot.evidenceReferences[0].token = "SECRET";
  assert.doesNotMatch(JSON.stringify(detailOf(clean)), /SECRET|token/);
});
test("Snapshot renders facts, claims, nullable lines, coverage and empty relations as escaped text", () => {
  const d = readyDetail(); d.latestReadySnapshot.evidenceReferences[0].summary = '<script>alert("x")</script>';
  const html = renderToStaticMarkup(createElement(AnalysisSnapshotView, {
    snapshot: d.latestReadySnapshot, repositories: d.repositories, previous: false,
  }));
  assert.match(html, /CODE_FACT/); assert.match(html, /DOC_CLAIM/);
  assert.match(html, /L3–5/); assert.match(html, /라인 정보 없음/); assert.match(html, /양쪽 근거로 확인된 관계가 없습니다/);
  assert.match(html, /unsupported_file/); assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script|<a |onclick=/i);
  assert.equal(renderToStaticMarkup(createElement(AnalysisSnapshotView, {
    snapshot: d.latestReadySnapshot, repositories: blockedDetail().repositories, previous: true,
  })), "");
});

test("detail refresh clears old data and ignores late success after a protected response or failure", async () => {
  const states = [], refs = [], effects = [], requests = [];
  let stateIndex = 0, refIndex = 0, refresh, expire;
  const react = { useState: initial => { const i = stateIndex++; if (!(i in states)) states[i] = initial;
    return [states[i], v => states[i] = typeof v === "function" ? v(states[i]) : v]; },
    useRef: initial => { const i = refIndex++; return refs[i] ??= { current: initial }; },
    useCallback: fn => { refresh = fn; return fn; }, useEffect: fn => effects.push(fn) };
  const noop = () => null;
  const { ProjectDetailView } = load("src/app/app/repoq/ProjectDetailView.tsx", {
    react, "next/link": noop, "lucide-react": { Plus: noop, RefreshCw: noop, X: noop }, "./project-ui": ui,
    "./AnalysisSnapshotView": { AnalysisSnapshotView }, "./GitHubMark": { GitHubMark: noop },
    "./RepositoryFields": { RepositoryFields: noop }, "./PrivateRepositoryPicker": { PrivateRepositoryPicker: noop },
  }, { fetch: () => new Promise((resolve, reject) => requests.push({ resolve, reject })),
    window: { location: { assign: noop }, setTimeout: (fn, ms) => { assert.equal(ms, 30000); expire = fn; return 1; },
      clearTimeout: noop } });
  ProjectDetailView({ id: readyDetail().id, privateEnabled: false });
  states[0] = readyDetail();
  const old = refresh(); assert.equal(states[0], null);
  const latest = refresh();
  requests[1].resolve(Response.json(blockedDetail())); await latest;
  requests[0].resolve(Response.json(readyDetail())); await old;
  assert.equal(states[0].latestReadySnapshot, null); assert.equal(states[0].repositories[0].commitSha, null);
  states[0] = readyDetail();
  const failed = refresh(); requests[2].reject(new DOMException("Timed out", "TimeoutError")); await failed;
  assert.equal(states[0], null); assert.equal(states[1], false); assert.ok(states[3]);
  states[0] = readyDetail(); stateIndex = 0; refIndex = 0; effects.length = 0;
  ProjectDetailView({ id: readyDetail().id, privateEnabled: false });
  effects.at(-1)(); expire();
  assert.equal(states[0], null); assert.equal(states[8], null); assert.ok(states[4]);
});
