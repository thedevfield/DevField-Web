import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function load(file, globals = {}, modules = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  runInNewContext(code, { exports, require: name => modules[name] ?? {}, ...globals });
  return exports;
}
const ui = load("src/app/app/repoq/interview-ui.ts");

test("FREE and MOCK are independently disabled by default", () => {
  class BffError extends Error {
    constructor(status, code) { super(code); this.status = status; }
  }
  const env = {};
  const { enabled } = load("src/lib/server/interview.ts", { process: { env } }, { "./auth": { BffError } });
  const blocked = error => error.status === 403 && error.message === "interview_disabled";
  assert.throws(() => enabled(), blocked);
  env.WEB_FREE_INTERVIEW_ENABLED = "true";
  assert.equal(enabled("FREE").FREE, true);
  assert.throws(() => enabled("MOCK"), blocked);
  env.WEB_FREE_INTERVIEW_ENABLED = "false";
  env.WEB_MOCK_INTERVIEW_ENABLED = "true";
  assert.equal(enabled("MOCK").MOCK, true);
  assert.throws(() => enabled("FREE"), blocked);
});

test("polls only while an interview worker is expected to publish", () => {
  const { shouldPoll } = ui;
  assert.equal(shouldPoll({ status: "PREPARING" }), true);
  assert.equal(shouldPoll({ status: "ACTIVE", answerProgress: "FOLLOW_UP_PENDING" }), true);
  assert.equal(shouldPoll({ status: "ACTIVE", evaluationStatus: "PENDING" }), true);
  assert.equal(shouldPoll({ status: "EVALUATING", evaluationStatus: "PENDING" }), true);
  assert.equal(shouldPoll({ status: "ACTIVE", answerProgress: "AWAITING_ANSWER" }), false);
  assert.equal(shouldPoll({ status: "ACTIVE", answerProgress: "FOLLOW_UP_FAILED" }), false);
  assert.equal(shouldPoll({ status: "EVALUATING", evaluationStatus: "FAILED" }), false);
  for (const status of ["PAUSED", "ENDED", "GENERATION_FAILED", "COMPLETED"]) {
    assert.equal(shouldPoll({ status, evaluationStatus: "PENDING", answerProgress: "FOLLOW_UP_PENDING" }), false);
  }
});

test("MOCK displays the five evaluations and summary together", () => {
  const { publishedMock } = ui;
  const completedBundleHistory = Array.from({ length: 5 }, (_, i) => ({ sequence: i + 1 }));
  const sessionEvaluation = { strengths: "strengths" };
  const complete = { mode: "MOCK", status: "COMPLETED", evaluationStatus: "READY", completedBundleHistory, sessionEvaluation };
  assert.equal(publishedMock({ ...complete, status: "EVALUATING" }), null);
  assert.equal(publishedMock({ ...complete, evaluationStatus: "PENDING" }), null);
  assert.equal(publishedMock({ ...complete, completedBundleHistory: completedBundleHistory.slice(0, 4) }), null);
  assert.equal(publishedMock({ ...complete, sessionEvaluation: undefined }), null);
  const batch = publishedMock(complete);
  assert.equal(batch.bundles, completedBundleHistory);
  assert.equal(batch.summary, sessionEvaluation);
});

function sessionView(fetch) {
  const states = [], refs = [], effects = [], jobs = [];
  const timers = new Map();
  let stateIndex, refIndex, effectIndex, now = 0, timerId = 0, submissionId = 0;
  const react = {
    useState(initial) {
      const index = stateIndex++;
      if (!(index in states)) states[index] = initial;
      return [states[index], value => { states[index] = typeof value === "function" ? value(states[index]) : value; }];
    },
    useRef(initial) { return refs[refIndex++] ??= { current: initial }; },
    useEffect(fn, deps) {
      const index = effectIndex++;
      const previous = effects[index];
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
        jobs.push(() => { previous?.cleanup?.(); effects[index] = { deps, cleanup: fn() }; });
      }
    },
  };
  const listeners = { addEventListener() {}, removeEventListener() {} };
  const globals = { fetch, AbortController, AbortSignal, Date: { now: () => now },
    document: { hidden: false, ...listeners }, window: listeners,
    crypto: { randomUUID: () => "submission-" + ++submissionId },
    setTimeout(fn, ms) { timers.set(++timerId, { fn, ms }); return timerId; },
    clearTimeout(id) { timers.delete(id); },
  };
  const projectUi = { csrfToken: async () => "csrf", async responseData(response) {
    if (!response.ok) throw new Error("HTTP " + response.status);
    return response.json();
  } };
  const interviewUi = load("src/app/app/repoq/interview-ui.ts", globals, { "./project-ui": projectUi });
  const element = (type, props) => ({ type, props });
  const { InterviewSessionView } = load("src/app/app/repoq/InterviewSessionView.tsx", globals, {
    react, "react/jsx-runtime": { jsx: element, jsxs: element }, "next/navigation": { useRouter: () => ({}) },
    "./interview-ui": interviewUi, "./project-ui": projectUi, "./workspace.module.css": { default: {} },
  });

  function render() {
    stateIndex = refIndex = effectIndex = 0;
    return InterviewSessionView({ id: "session", projectId: "project" });
  }
  function find(node, predicate) {
    if (Array.isArray(node)) return node.map(child => find(child, predicate)).find(Boolean);
    if (!node?.props) return undefined;
    return predicate(node) ? node.props : find(node.props.children, predicate);
  }
  return {
    async update() {
      render();
      while (jobs.length) jobs.shift()();
      await new Promise(setImmediate);
      render();
      while (jobs.length) jobs.shift()();
      await new Promise(setImmediate);
    },
    control(type, label) { return find(render(), node => node.type === type && (!label || node.props.children === label)); },
    delays() { return [...timers.values()].map(timer => timer.ms); },
    fire(ms) {
      const [id, timer] = [...timers].find(([, entry]) => entry.ms === ms) ?? [];
      assert.ok(timer, "expected a " + ms + "ms timer");
      timers.delete(id);
      now += ms;
      timer.fn();
    },
  };
}

const activeQuestion = id => ({ mode: "FREE", status: "ACTIVE", completedBundles: 0,
  answerProgress: "AWAITING_ANSWER", currentQuestion: { id, text: id } });

test("a second tab advancing the session cannot transfer an unsubmitted draft", async () => {
  let detail = activeQuestion("question-A");
  const requests = [];
  const backend = async (path, { method, body }) => {
    if (method === "GET") return Response.json(detail);
    requests.push(JSON.parse(body));
    detail = activeQuestion("question-B");
    return Response.json({}, { status: 202 });
  };
  const first = sessionView(backend), second = sessionView(backend);
  await first.update();
  await second.update();
  first.control("textarea").onChange({ target: { value: "unsubmitted draft for A" } });
  second.control("textarea").onChange({ target: { value: "answer for A" } });
  second.control("form").onSubmit({ preventDefault() {} });
  await second.update();

  first.control("button", "상태 다시 확인").onClick();
  await first.update();
  assert.equal(first.control("textarea").value, "");
  first.control("form").onSubmit({ preventDefault() {} });
  await first.update();
  assert.equal(requests.length, 1);
});

test("a second tab advancing the session cannot transfer the first tab's draft or submission key", async () => {
  let detail = activeQuestion("question-A");
  let rejectFirstTab = true;
  const requests = [];
  const backend = name => async (path, { method, body }) => {
    if (method === "GET") return Response.json(detail);
    const input = JSON.parse(body);
    requests.push({ name, ...input });
    if (name === "first" && rejectFirstTab) return Response.json({}, { status: 503 });
    detail = activeQuestion("question-B");
    return Response.json({}, { status: 202 });
  };
  const first = sessionView(backend("first")), second = sessionView(backend("second"));
  await first.update();
  await second.update();
  first.control("textarea").onChange({ target: { value: "draft for A" } });
  const submit = view => view.control("form").onSubmit({ preventDefault() {} });
  submit(first);
  await first.update();
  submit(first);
  await first.update();
  assert.deepEqual(requests[0], requests[1]);

  second.control("textarea").onChange({ target: { value: "another answer for A" } });
  submit(second);
  await second.update();
  first.control("button", "상태 다시 확인").onClick();
  await first.update();
  assert.equal(first.control("textarea").value, "");
  assert.equal(first.control("textarea").readOnly, false);
  submit(first);
  await first.update();
  assert.equal(requests.length, 3);

  rejectFirstTab = false;
  first.control("textarea").onChange({ target: { value: "answer for B" } });
  submit(first);
  await first.update();
  assert.equal(requests[3].questionId, "question-B");
  assert.equal(requests[3].answer, "answer for B");
  assert.notEqual(requests[3].submissionId, requests[0].submissionId);
});

test("FREE topic expiry blocks I-05 until the same choice is reconfirmed", async () => {
  const requests = [];
  const view = sessionView(async (path, { method, body } = {}) => {
    if (path.startsWith("/api/repoq/projects/")) return Response.json({
      latestReadySnapshot: { snapshotId: "snapshot", topics: ["API_BACKEND", "DATABASE"] },
    });
    if (method === "POST") { requests.push(JSON.parse(body)); return Response.json({}, { status: 202 }); }
    return Response.json({ ...activeQuestion("question-A"), currentBundleId: "bundle", snapshotId: "snapshot",
      topicKey: "API_BACKEND", evaluationStatus: "READY" });
  });
  await view.update();
  view.control("select").onChange({ target: { value: "DATABASE" } });
  assert.equal(view.control("select").value, "DATABASE");
  view.fire(30000);
  assert.equal(view.control("select").value, "");
  const next = () => view.control("button", "다음 묶음 요청");
  assert.equal(next().disabled, true);
  next().onClick();
  assert.deepEqual(requests, []);
  view.control("button", "출제 분야 다시 확인").onClick();
  await view.update();
  assert.equal(view.control("select").value, "DATABASE");
  assert.equal(next().disabled, false);
  assert.deepEqual(requests, []);
  next().onClick();
  await view.update();
  assert.deepEqual(requests, [{ previousBundleId: "bundle", topicKey: "DATABASE" }]);
});

test("I-03 polling recovers from a 503, stops at the retry limit and never retries a 403", async () => {
  const responses = [{ status: "PREPARING" }, 503, activeQuestion("question-A"), 503, 503, 503, 403];
  let reads = 0;
  const view = sessionView(async () => {
    reads++;
    const response = responses.shift();
    return typeof response === "number" ? Response.json({}, { status: response }) : Response.json(response);
  });
  await view.update();
  view.fire(1500);
  await view.update();
  view.fire(1500);
  await view.update();
  assert.equal(view.control("textarea").value, "");
  assert.deepEqual(view.delays(), []);

  view.control("button", "상태 다시 확인").onClick();
  await view.update();
  view.fire(1500);
  await view.update();
  view.fire(3000);
  await view.update();
  assert.equal(reads, 6);
  assert.deepEqual(view.delays(), []);

  view.control("button", "상태 다시 확인").onClick();
  await view.update();
  assert.equal(reads, 7);
  assert.deepEqual(view.delays(), []);
});
