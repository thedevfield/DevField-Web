"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { InterviewAnswer, InterviewDetail, InterviewEvaluation } from "@/lib/interview";
import { responseData, type ProjectDetail } from "./project-ui";
import { InterviewReadUnavailable, interviewFetch, interviewStatus, publishedMock, shouldPoll } from "./interview-ui";
import styles from "./workspace.module.css";

function Answers({ answers }: { answers: InterviewAnswer[] }) {
  return answers.length > 0 && <ol className={styles.interviewText}>{answers.map(item => <li key={item.questionId}><strong>{item.question}</strong><p>{item.answer}</p></li>)}</ol>;
}

function Evaluation({ result }: { result: InterviewEvaluation }) {
  return <dl className={styles.interviewText}>
    <dt>강점</dt><dd>{result.strengths}</dd><dt>보완점</dt><dd>{result.gaps}</dd>
    <dt>개선 방법</dt><dd>{result.improvements}</dd><dt>예시 답변</dt><dd>{result.exampleAnswer}</dd>
    <dt>핵심 요점</dt><dd>{result.keyPoints}</dd><dt>평가 한계</dt><dd>{result.limitations}</dd>
  </dl>;
}

export function InterviewSessionView({ id, projectId }: { id: string; projectId?: string }) {
  const router = useRouter();
  const path = "/" + id;
  const [detail, setDetail] = useState<InterviewDetail | null>(null);
  const [draft, setDraft] = useState<{ questionId: string; answer: string; submissionId?: string } | null>(null);
  const [nextTopic, setNextTopic] = useState("RANDOM");
  const [topicProof, setTopicProof] = useState<{ bundleId: string; topics: string[]; expiresAt: number } | null>(null);
  const [topicRefresh, setTopicRefresh] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [readError, setReadError] = useState("");
  const [actionError, setActionError] = useState("");
  const read = useRef<AbortController | null>(null);
  const mutation = useRef<AbortController | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let retries = 0;
    function stop() {
      clearTimeout(timer);
      read.current?.abort();
    }
    async function load() {
      stop();
      if (document.hidden || busy || mutation.current) return;
      const controller = new AbortController();
      read.current = controller;
      try {
        const value = await interviewFetch<InterviewDetail>(path, "GET", undefined, controller.signal);
        if (controller.signal.aborted) return;
        retries = 0;
        setDraft(current => current && (value.currentQuestion && value.currentQuestion.id !== current.questionId
          || value.answers?.some(item => item.questionId === current.questionId)) ? null : current);
        setDetail(value);
        setReadError("");
        if (shouldPoll(value)) timer = setTimeout(() => void load(), 1500);
      } catch (error) {
        if (controller.signal.aborted) return;
        setDetail(null);
        if (error instanceof InterviewReadUnavailable && retries < 2) {
          timer = setTimeout(() => void load(), 1500 * ++retries);
          return;
        }
        setReadError(error instanceof Error ? error.message : "면접 상태를 확인하지 못했습니다.");
      }
    }
    function hide() { stop(); setDetail(null); }
    function visibility() { if (document.hidden) hide(); else void load(); }
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", visibility);
    void load();
    return () => {
      stop();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", visibility);
    };
  }, [path, busy, refresh]);

  useEffect(() => () => mutation.current?.abort(), []);

  async function change(method: string, suffix = "", body?: object) {
    if (mutation.current) return;
    const controller = new AbortController();
    mutation.current = controller;
    read.current?.abort();
    setBusy(true);
    setActionError("");
    try {
      await interviewFetch(path + suffix, method, body, controller.signal);
      if (controller.signal.aborted) return;
      setDetail(null);
      if (method === "DELETE") {
        router.replace("/app/repoq");
        return;
      }
      if (suffix === "/answers") setDraft(null);
    } catch (error) {
      if (!controller.signal.aborted) setActionError(error instanceof Error ? error.message : "요청을 확인하지 못했습니다.");
    } finally {
      if (!controller.signal.aborted) {
        mutation.current = null;
        setBusy(false);
      }
    }
  }

  function submit(questionId: string) {
    if (draft?.questionId !== questionId || !draft.answer.trim() || mutation.current) return;
    const submission = { ...draft, submissionId: draft.submissionId ?? crypto.randomUUID() };
    setDraft(submission);
    void change("POST", "/answers", submission);
  }

  const question = detail?.currentQuestion;
  const currentDraft = draft?.questionId === question?.id ? draft : null;
  const mock = detail?.mode === "MOCK";
  const batch = detail && publishedMock(detail);
  const history = mock ? batch?.bundles : detail?.completedBundleHistory;
  const currentInHistory = history?.some(bundle => bundle.bundleId === detail?.currentBundleId);
  const canAnswer = detail?.status === "ACTIVE" && question && detail.answerProgress === "AWAITING_ANSWER";
  const canNext = detail?.mode === "FREE" && detail.status === "ACTIVE" && detail.evaluationStatus === "READY" && detail.currentBundleId;
  const canRetryMock = mock && (detail?.status === "ACTIVE" && detail.answerProgress === "FOLLOW_UP_FAILED"
    || detail?.status === "EVALUATING" && detail.evaluationStatus === "FAILED");
  const canPause = detail && ["PREPARING", "ACTIVE", "EVALUATING"].includes(detail.status);
  const snapshotId = detail?.snapshotId;
  useEffect(() => {
    setTopicProof(null);
    if (!canNext || !snapshotId || !projectId) return;
    const controller = new AbortController();
    let expiry: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const response = await fetch("/api/repoq/projects/" + projectId, { cache: "no-store",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]) });
        const project: ProjectDetail = await responseData(response);
        const snapshot = project.latestReadySnapshot;
        if (!controller.signal.aborted && canNext && snapshot && snapshot.snapshotId === snapshotId) {
          setTopicProof({ bundleId: canNext, topics: snapshot.topics, expiresAt: Date.now() + 30000 });
          expiry = setTimeout(() => setTopicProof(null), 30000);
        }
      } catch { /* I-05 can still use RANDOM and previously used pinned topics. */ }
    }
    void load();
    return () => { controller.abort(); clearTimeout(expiry); };
  }, [canNext, snapshotId, projectId, topicRefresh]);

  const knownTopics = new Set(["RANDOM", ...(history?.map(bundle => bundle.topicKey) ?? []),
    ...(detail?.topicKey ? [detail.topicKey] : [])]);
  const verifiedTopics = topicProof && topicProof.bundleId === canNext ? topicProof : null;
  const topics = new Set([...knownTopics, ...(verifiedTopics && verifiedTopics.expiresAt > Date.now() ? verifiedTopics.topics : [])]);
  const selectionValid = topics.has(nextTopic);

  return <main className={styles.main}>
    <nav className={styles.breadcrumbs} aria-label="현재 위치"><Link href="/app/repoq">RepoQ 프로젝트 목록</Link><span>/</span><span>면접</span></nav>
    <h1>{detail ? mock ? "모의면접" : "자유연습" : "면접"}</h1>
    {readError && <p className={styles.error} role="alert">{readError}</p>}
    {actionError && <p className={styles.error} role="alert">{actionError}</p>}
    {!detail && !readError && <p role="status">면접 정보를 확인하는 중입니다.</p>}
    <button className={styles.secondary} disabled={busy} onClick={() => setRefresh(value => value + 1)}>상태 다시 확인</button>
    {detail && <>
      <p role="status">{interviewStatus[detail.status]} · 완료 {detail.completedBundles}{mock ? " / 5" : ""}묶음</p>
      {mock && !batch && <p className={styles.help}>다섯 묶음과 종합 평가가 준비되면 결과를 함께 공개합니다.</p>}
      {detail.answerProgress === "FOLLOW_UP_PENDING" && <p role="status">꼬리질문을 확인하는 중입니다.</p>}
      {detail.answerProgress === "FOLLOW_UP_FAILED" && <p>답변은 저장되었습니다. 꼬리질문 생성에 실패했습니다.</p>}
      {detail.evaluationStatus === "PENDING" && <p role="status">평가를 생성하는 중입니다.</p>}
      {detail.evaluationStatus === "FAILED" && <p>평가를 생성하지 못했습니다.</p>}
      {question && <section className={styles.card}><h2>현재 질문</h2><p>{question.text}</p>
        {canAnswer && <form className={styles.interviewControls} onSubmit={event => { event.preventDefault(); submit(question.id); }}>
          <label htmlFor="interview-answer">내 답변</label>
          <textarea id="interview-answer" value={currentDraft?.answer ?? ""} required maxLength={4000} rows={6}
            readOnly={!!currentDraft?.submissionId} disabled={busy}
            onChange={event => setDraft({ questionId: question.id, answer: event.target.value })} />
          <button className={styles.primary} disabled={busy || !currentDraft?.answer.trim()}>{currentDraft?.submissionId ? "같은 답변 다시 제출" : "답변 제출"}</button>
        </form>}
      </section>}
      {!currentInHistory && (!!detail.answers?.length || !mock && detail.evaluation) && <section className={styles.card}>
        <h2>현재 묶음</h2><Answers answers={detail.answers ?? []} />
        {!mock && detail.evaluation && <Evaluation result={detail.evaluation} />}
      </section>}
      {canNext && <section className={styles.card}><h2>다음 질문 묶음</h2><div className={styles.interviewControls}>
        <label>출제 분야 <select value={selectionValid ? nextTopic : ""} disabled={busy} onChange={event => setNextTopic(event.target.value)}>
          {!selectionValid && <option value="" disabled>분야 재확인 필요</option>}
          {[...topics].map(topic => <option key={topic} value={topic}>{topic === "RANDOM" ? "무작위" : topic}</option>)}
        </select></label>
        {!selectionValid && <button className={styles.secondary} disabled={busy} onClick={() => setTopicRefresh(value => value + 1)}>출제 분야 다시 확인</button>}
        <button className={styles.primary} disabled={busy || !selectionValid} onClick={() => {
          if (!knownTopics.has(nextTopic) && (!verifiedTopics || verifiedTopics.expiresAt <= Date.now())) {
            setTopicProof(null);
            return;
          }
          void change("POST", "/bundles", { previousBundleId: canNext, topicKey: nextTopic });
        }}>다음 묶음 요청</button>
      </div></section>}
      {batch && <section className={styles.card}><h2>모의면접 종합 평가</h2><dl className={styles.interviewText}>
        <dt>강점</dt><dd>{batch.summary.strengths}</dd><dt>보완점</dt><dd>{batch.summary.gaps}</dd>
        <dt>일관성</dt><dd>{batch.summary.consistency}</dd><dt>학습 분야</dt><dd>{batch.summary.studyAreas}</dd>
        <dt>평가 한계</dt><dd>{batch.summary.limitations}</dd>
      </dl></section>}
      {history?.map(bundle => <section key={bundle.bundleId} className={styles.card}>
        <h2>{bundle.sequence}번째 묶음 · {bundle.topicKey}</h2><Answers answers={bundle.answers} /><Evaluation result={bundle.evaluation} />
      </section>)}
      <div className={styles.interviewControls}>
        {canPause && <button className={styles.secondary} disabled={busy} onClick={() => void change("PATCH", "", { action: "PAUSE" })}>일시 중단</button>}
        {(detail.status === "PAUSED" || canRetryMock) && <button className={styles.secondary} disabled={busy} onClick={() => void change("PATCH", "", { action: "RESUME" })}>{detail.status === "PAUSED" ? "재개" : "실패한 작업 다시 시도"}</button>}
        {!mock && detail.status !== "ENDED" && <button className={styles.secondary} disabled={busy} onClick={() => {
          if (window.confirm("면접을 종료할까요? 제출한 기록은 보관됩니다.")) void change("PATCH", "", { action: "END" });
        }}>면접 종료</button>}
        <button className={styles.danger} disabled={busy} onClick={() => {
          const abandon = mock && detail.status !== "COMPLETED";
          if (window.confirm(abandon ? "모의면접을 포기하고 면접 기록을 삭제할까요?" : "이 면접 기록을 삭제할까요?"))
            void change("DELETE", abandon ? "?confirmAbandon=true" : "");
        }}>{mock && detail.status !== "COMPLETED" ? "포기하고 삭제" : "면접 기록 삭제"}</button>
      </div>
    </>}
  </main>;
}
