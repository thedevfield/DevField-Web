"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { InterviewDetail, InterviewHistory, InterviewMode } from "@/lib/interview";
import type { ProjectDetail } from "./project-ui";
import { interviewFetch, interviewStatus } from "./interview-ui";
import styles from "./workspace.module.css";

export function InterviewProjectPanel({ projectId, project, modes }: { projectId: string; project: ProjectDetail | null; modes: Record<InterviewMode, boolean> }) {
  const router = useRouter();
  const [history, setHistory] = useState<InterviewHistory | null>(null);
  const [busy, setBusy] = useState(false);
  const [topicKey, setTopic] = useState("RANDOM");
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const startRequest = useRef<AbortController | null>(null);
  const canList = (modes.FREE || modes.MOCK) && project?.projectStatus === "ACTIVE";
  const snapshot = project?.latestReadySnapshot;
  const topics = snapshot?.topics ?? [];
  const canStart = canList && topics.length > 0;

  const load = useCallback(async (controller: AbortController, cursor?: string) => {
    try {
      const query = new URLSearchParams({ projectId });
      if (cursor) query.set("cursor", cursor);
      const page = await interviewFetch<InterviewHistory>("?" + query, "GET", undefined, controller.signal);
      if (!controller.signal.aborted) setHistory(previous => ({
        ...page, items: cursor && previous
          ? [...previous.items, ...page.items.filter(item => !previous.items.some(seen => seen.interviewId === item.interviewId))]
          : page.items,
      }));
    } catch {
      if (!controller.signal.aborted) {
        setHistory(null);
        setError("면접 이력을 불러오지 못했습니다.");
      }
    }
  }, [projectId]);

  useEffect(() => {
    if (!canList) { setHistory(null); return; }
    const controller = new AbortController();
    request.current = controller;
    void load(controller);
    return () => { controller.abort(); request.current?.abort(); };
  }, [canList, load]);

  useEffect(() => () => startRequest.current?.abort(), []);

  async function start(mode: InterviewMode) {
    if (startRequest.current || !canStart) return;
    request.current?.abort();
    const controller = new AbortController();
    startRequest.current = controller;
    setBusy(true);
    setError("");
    let navigating = false;
    try {
      const detail = await interviewFetch<InterviewDetail>("", "POST",
        mode === "FREE" ? { projectId, mode, topicKey: topics.includes(topicKey) ? topicKey : "RANDOM" } : { projectId, mode },
        controller.signal);
      if (!controller.signal.aborted) {
        navigating = true;
        router.push("/app/repoq/interviews/" + detail.interviewId + "?projectId=" + projectId);
        return;
      }
    } catch {
      if (!controller.signal.aborted) await load(controller);
      if (!controller.signal.aborted) setError("시작을 확인하지 못했습니다. 다시 요청하기 전에 면접 이력을 확인해 주세요.");
    } finally {
      if (!controller.signal.aborted && !navigating) {
        startRequest.current = null;
        setBusy(false);
      }
    }
  }

  if (!project && !busy && !error) return null;
  return <section className={styles.card}><div className={styles.kicker}>PRACTICE / INTERVIEW</div><h2>연습과 모의면접</h2>
    {busy && <p role="status">면접을 시작하는 중입니다.</p>}
    {error && <p role="alert">{error}</p>}
    {!canList ? <p className={styles.help}>현재 면접 기능을 이용할 수 없습니다.</p> : <>
      {!canStart && <p className={styles.help}>접근이 확인된 공개 Repository 분석과 출제 분야가 준비되면 시작할 수 있습니다.</p>}
      <div className={styles.interviewControls}>
        {modes.FREE && <>
          <label>자유연습 분야 <select value={topics.includes(topicKey) ? topicKey : "RANDOM"} disabled={!canStart || busy} onChange={event => setTopic(event.target.value)}>
            <option value="RANDOM">무작위</option>{topics.filter(topic => topic !== "RANDOM").map(topic => <option key={topic}>{topic}</option>)}
          </select></label>
          <button className={styles.secondary} disabled={!canStart || busy} onClick={() => void start("FREE")}>자유연습 시작</button>
        </>}
        {modes.MOCK && <button className={styles.secondary} disabled={!canStart || busy} onClick={() => void start("MOCK")}>모의면접 시작</button>}
      </div>
      <h3>면접 이력</h3>
      {history?.items.length === 0 && <p>저장된 면접 이력이 없습니다.</p>}
      {history && <ul>{history.items.map(item => <li key={item.interviewId}>
        <Link href={"/app/repoq/interviews/" + item.interviewId + "?projectId=" + projectId} prefetch={false}>
          {item.mode === "FREE" ? "자유연습" : "모의면접"} · {interviewStatus[item.status]} · {item.completedBundles}묶음 · <time dateTime={item.createdAt}>{item.createdAt.slice(0, 10)}</time>
        </Link>
      </li>)}</ul>}
      {(history?.nextCursor || !history && error) && <button className={styles.secondary} disabled={busy} onClick={() => {
        request.current?.abort();
        const controller = new AbortController();
        request.current = controller;
        setError("");
        void load(controller, history?.nextCursor ?? undefined);
      }}>{history ? "이력 더 보기" : "이력 다시 확인"}</button>}
    </>}
  </section>;
}
