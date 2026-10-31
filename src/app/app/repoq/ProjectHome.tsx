"use client";
import Link from "next/link";
import { Plus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { messageFor, responseData, statusText, type ProjectItem } from "./project-ui";
import { GitHubMark } from "./GitHubMark";
import styles from "./workspace.module.css";

export function ProjectHome() {
  const [projects, setProjects] = useState<ProjectItem[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/repoq/projects", { cache: "no-store" });
      if (response.status === 401) { window.location.assign("/login"); return; }
      const data = await responseData(response);
      if (!Array.isArray(data)) throw new Error(messageFor("project_unavailable"));
      setProjects(data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : messageFor("project_unavailable")); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return <main className={styles.main} id="main">
    <nav className={styles.breadcrumbs} aria-label="현재 위치"><Link href="/app">Workspace</Link><span aria-hidden="true">/</span><span aria-current="page">RepoQ</span></nav>
    <div className={styles.kicker}>REPOQ / PROJECTS</div>
    <div className={styles.heroRow}><div><h1>내 프로젝트</h1><p className={styles.lead}>공개 Repository를 모아 나만의 RepoQ 프로젝트를 관리하세요.</p></div>
      <Link className={styles.primary} href="/app/repoq/projects/new"><Plus size={18} aria-hidden="true" />새 프로젝트</Link></div>
    <div className={styles.toolbar}><Link href="/app/repoq/settings/github"><GitHubMark size={15} /> GitHub App 연결 관리 →</Link></div>
    {loading && <p className={styles.notice} role="status">프로젝트를 불러오는 중입니다…</p>}
    {error && <div className={styles.error} role="alert"><p>{error}</p><button type="button" className={styles.secondary} onClick={() => void load()}><RefreshCw size={16} /> 다시 시도</button></div>}
    {!loading && !error && projects?.length === 0 && <section className={styles.empty}><GitHubMark size={30} />
      <h2>아직 프로젝트가 없습니다</h2><p>프로젝트 이름과 첫 공개 Repository를 등록해 시작하세요.</p>
      <Link className={styles.primary} href="/app/repoq/projects/new">프로젝트 만들기</Link></section>}
    {!loading && !error && !!projects?.length && <section aria-label="내 프로젝트 목록" className={styles.projectList}>
      <div className={styles.projectListHead} aria-hidden="true"><span>프로젝트</span><span>Repository</span><span>분석 상태</span><span /></div>
      {projects.map(project => <article className={styles.projectRow} key={project.id}>
        <div className={styles.projectIdentity}><span className={styles.projectMark}><GitHubMark size={18} /></span><div><h2>{project.name}</h2><p className={styles.projectId}>ID {project.id}</p></div></div>
        <strong className={styles.repoCount}><span className={styles.mobileLabel}>Repository </span>{project.repositoryCount}개</strong>
        <span className={styles.badge} data-status={project.analysisStatus}>{statusText[project.analysisStatus] ?? project.analysisStatus}</span>
        <Link className={styles.cardLink} href={`/app/repoq/projects/${project.id}`} aria-label={`${project.name} 상세 보기`}>상세 보기 →</Link>
      </article>)}
    </section>}
  </main>;
}
