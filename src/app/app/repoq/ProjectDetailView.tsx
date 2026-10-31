"use client";
import Link from "next/link";
import { Plus, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { csrfToken, messageFor, responseData, statusText, urlsOf, type Member, type ProjectDetail } from "./project-ui";
import { GitHubMark } from "./GitHubMark";
import { RepositoryFields } from "./RepositoryFields";
import styles from "./workspace.module.css";

export function ProjectDetailView({ id }: { id: string }) {
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [rows, setRows] = useState([""]);
  const [adding, setAdding] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<Member | null>(null);
  const pending = useRef<{ body: string; key: string } | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!removeTarget) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
    focusable()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) setRemoveTarget(null);
      if (event.key !== "Tab") return;
      const options = focusable(); if (!options.length) return;
      if (event.shiftKey && document.activeElement === options[0]) { event.preventDefault(); options.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === options.at(-1)) { event.preventDefault(); options[0].focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); previous?.focus(); };
  }, [removeTarget, busy]);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/repoq/projects/${id}`, { cache: "no-store" });
      if (response.status === 401) { window.location.assign("/login"); return; }
      setProject(await responseData(response));
    } catch (cause) { setError(cause instanceof Error ? cause.message : messageFor("project_unavailable")); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  async function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    setError(""); setNotice("");
    let body: string;
    try { body = JSON.stringify({ repositories: urlsOf(rows) }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Repository URL을 확인해 주세요."); return; }
    if (pending.current?.body !== body) pending.current = { body, key: crypto.randomUUID() };
    setBusy(true);
    try {
      const csrf = await csrfToken();
      const response = await fetch(`/api/repoq/projects/${id}/repositories`, { method: "POST", cache: "no-store",
        headers: { "Content-Type": "application/json", "x-devfield-csrf": csrf, "Idempotency-Key": pending.current.key }, body });
      if (response.status === 401) { window.location.assign("/login"); return; }
      const added = await responseData(response);
      setProject(current => current ? { ...current, repositories: added.repositories, membershipVersion: added.membershipVersion,
        analysisStatus: added.analysisStatus, latestReadySnapshot: null, canInterview: false } : current);
      pending.current = null; setRows([""]); setAdding(false); setNotice("Repository를 추가했습니다. 분석이 대기 중입니다.");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Repository를 추가하지 못했습니다. 다시 시도해 주세요."); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!removeTarget || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const csrf = await csrfToken();
      const response = await fetch(`/api/repoq/projects/${id}/repositories/${removeTarget.id}`, { method: "DELETE", cache: "no-store",
        headers: { "x-devfield-csrf": csrf } });
      if (response.status === 401) { window.location.assign("/login"); return; }
      await responseData(response);
      setProject(current => current ? { ...current, repositories: current.repositories.filter(member => member.id !== removeTarget.id),
        membershipVersion: current.membershipVersion + 1, analysisStatus: "QUEUED", latestReadySnapshot: null, canInterview: false } : current);
      setRemoveTarget(null); setNotice("Repository 연결을 제거했습니다. GitHub 원본은 유지됩니다.");
      await load();
    } catch (cause) { setRemoveTarget(null); setError(cause instanceof Error ? cause.message : "Repository 연결을 제거하지 못했습니다."); }
    finally { setBusy(false); }
  }
  return <main className={styles.main} id="main">
    <nav className={styles.breadcrumbs} aria-label="현재 위치"><Link href="/app">Workspace</Link><span aria-hidden="true">/</span><Link href="/app/repoq">RepoQ</Link><span aria-hidden="true">/</span><span aria-current="page">프로젝트 상세</span></nav>
    <div className={styles.kicker}>PROJECT / DETAIL</div>
    {loading && !project && <p className={styles.notice} role="status">프로젝트를 불러오는 중입니다…</p>}
    {error && <div className={styles.error} role="alert"><p>{error}</p>{!project && <button type="button" className={styles.secondary} onClick={() => void load()}><RefreshCw size={16} /> 다시 시도</button>}</div>}
    {notice && <p className={styles.notice} role="status">{notice}</p>}
    {project && <><div className={styles.detailHeading}><div><h1>{project.name}</h1><p className={styles.projectId}>프로젝트 ID · {project.id}</p></div>
      <span className={styles.badge} data-status={project.analysisStatus}>{statusText[project.analysisStatus] ?? project.analysisStatus}</span></div>
      <div className={styles.detailLayout}><div className={styles.detailPrimary}>
      <section className={styles.card} aria-labelledby="repo-title"><div className={styles.heroRow}><div><div className={styles.kicker}>REPOSITORIES</div><h2 id="repo-title">연결된 Repository <span className={styles.countLabel}>{project.repositories.length}개</span></h2></div>
        <button type="button" className={styles.primary} disabled={busy || project.analysisStatus === "RUNNING"} onClick={() => setAdding(value => !value)}><Plus size={17} /> Repository 추가</button></div>
        <ul className={styles.memberList}>{project.repositories.map(member => <li key={member.id}>
          <GitHubMark /><div className={styles.memberText}><strong>{member.fullName}</strong>
            <span>{member.visibility === "PUBLIC" ? "Public" : "Private"} · {statusText[member.analysisStatus] ?? member.analysisStatus}</span></div>
          <button type="button" className={styles.iconButton} aria-label={`${member.fullName} 연결 제거`} title="연결 제거"
            disabled={busy || project.repositories.length <= 1 || project.analysisStatus === "RUNNING"} onClick={() => setRemoveTarget(member)}><X size={19} aria-hidden="true" /></button>
        </li>)}</ul>
        {project.repositories.length <= 1 && <p className={styles.help}>마지막 Repository는 제거할 수 없습니다. 프로젝트 삭제 기능은 아직 준비 중입니다.</p>}
        {project.analysisStatus === "RUNNING" && <p className={styles.help}>분석 중에는 Repository를 추가하거나 제거할 수 없습니다.</p>}
        {adding && <form className={styles.inlineForm} onSubmit={event => void add(event)}><RepositoryFields rows={rows} onChange={setRows} disabled={busy} />
          <div className={styles.actions}><button type="submit" className={styles.primary} disabled={busy}>{busy ? "추가 중…" : "Repository 추가"}</button>
            <button type="button" className={styles.secondary} disabled={busy} onClick={() => setAdding(false)}>취소</button></div></form>}
      </section></div><aside className={styles.detailAside} aria-label="프로젝트 상태 및 정보">
      <section className={`${styles.card} ${styles.analysisCard}`}><div className={styles.kicker}>ANALYSIS / STATUS</div><h2>분석 상태</h2>
        <span className={styles.badge} data-status={project.analysisStatus}>{statusText[project.analysisStatus] ?? project.analysisStatus}</span>
        <p>{project.analysisStatus === "QUEUED" ? "Repository 등록이 완료됐습니다. 분석 작업이 시작되기를 기다리고 있습니다." :
          project.analysisStatus === "RUNNING" ? "분석 중에는 Repository 구성을 변경할 수 없습니다." :
          project.analysisStatus === "FAILED" ? "분석에 실패했습니다. 현재 분석 결과는 제공되지 않습니다." :
          project.analysisStatus === "INSUFFICIENT_EVIDENCE" ? "분석 근거가 부족합니다. 현재 면접을 시작할 수 없습니다." :
          "현재 사용할 수 있는 분석 결과가 없습니다."}</p>
      </section>
      <section className={styles.card}><div className={styles.kicker}>PROJECT CONTEXT</div><h2>프로젝트 정보</h2>
        <dl className={styles.metaList}><div><dt>프로젝트 ID</dt><dd>{project.id}</dd></div><div><dt>Repository</dt><dd>{project.repositories.length}개</dd></div><div><dt>분석 상태</dt><dd>{statusText[project.analysisStatus] ?? project.analysisStatus}</dd></div><div><dt>면접 가능</dt><dd>{project.canInterview && project.latestReadySnapshot ? "가능" : "아직 불가"}</dd></div></dl>
      </section>
      <section className={styles.card}><div className={styles.kicker}>PRACTICE / INTERVIEW</div><h2>연습과 모의면접</h2>
        <p className={styles.help}>분석 결과와 면접 기능이 준비되면 이용할 수 있습니다. 현재 면접 질문이나 평가를 생성하지 않습니다.</p>
        <div className={styles.actions}><button type="button" className={styles.secondary} disabled>자유연습 준비 중</button>
          <button type="button" className={styles.secondary} disabled>모의면접 준비 중</button></div>
      </section><Link className={styles.secondary} href="/app/repoq">← 프로젝트 목록</Link></aside></div></>}
    {removeTarget && <div className={styles.dialogBackdrop}><div ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="remove-title" aria-describedby="remove-description">
      <h2 id="remove-title">Repository 연결을 제거할까요?</h2><p id="remove-description"><strong>{removeTarget.fullName}</strong>을 이 프로젝트에서 제거합니다. GitHub 원본 Repository는 삭제되지 않습니다.</p>
      <div className={styles.actions}><button type="button" className={styles.danger} disabled={busy} onClick={() => void remove()}>{busy ? "제거 중…" : "연결 제거"}</button>
        <button type="button" className={styles.secondary} disabled={busy} onClick={() => setRemoveTarget(null)}>취소</button></div></div></div>}
  </main>;
}
