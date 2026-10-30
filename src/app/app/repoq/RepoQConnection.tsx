"use client";

import Link from "next/link";
import { GitHubMark } from "./GitHubMark";
import { useCallback, useEffect, useState } from "react";
import styles from "./page.module.css";

type Status = { userAuthorization: "NOT_AUTHORIZED" | "AUTHORIZED" | "REAUTHORIZE"; installation: "NOT_INSTALLED" | "PENDING_APPROVAL" | "INSTALLED" };
type Listing = { status: string; repositories: { id: number; fullName: string; name: string; private: boolean }[]; page: number; hasNext: boolean };
const messages: Record<string, string> = {
  authorized: "GitHub 사용자 승인이 완료되었습니다. App 설치를 이어서 진행해 주세요.",
  connected: "GitHub App 연결이 완료되었습니다.", pending: "조직 관리자 승인을 기다리는 중입니다. 승인 후 다시 연결을 시작해 주세요.",
  cancelled: "GitHub 사용자 승인이 취소되었습니다.", expired: "연결 시도가 만료되었거나 이미 처리되었습니다. 다시 시작해 주세요.",
  denied: "설치에 접근할 수 없습니다. GitHub 권한을 확인해 주세요.", conflict: "이 GitHub 계정은 현재 연결에 사용할 수 없습니다.",
  failed: "연결을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.",
};

export function RepoQConnection() {
  const [status, setStatus] = useState<Status>();
  const [listing, setListing] = useState<Listing>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const load = useCallback(async (page = 1) => {
    setError("");
    try {
      const [a, b] = await Promise.all([
        fetch("/api/github/connections", { cache: "no-store" }),
        fetch(`/api/github/repositories?page=${page}`, { cache: "no-store" }),
      ]);
      if (!a.ok || !b.ok) throw new Error();
      setStatus(await a.json()); setListing(await b.json());
    } catch { setError("연결 상태를 불러오지 못했습니다. 다시 시도해 주세요."); }
  }, []);
  useEffect(() => { const params = new URLSearchParams(window.location.search); setResult(params.get("result") ?? ""); window.history.replaceState(null, "", "/app/repoq/settings/github"); void load(); }, [load]);
  async function start() {
    setBusy(true); setError("");
    try {
      const csrf = await fetch("/api/auth/csrf", { cache: "no-store" });
      if (!csrf.ok) throw new Error();
      const { token } = await csrf.json();
      const response = await fetch("/api/github/connections/start", { method: "POST", headers: { "x-devfield-csrf": token, "Content-Type": "application/json" } });
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (!data.url || !["AUTHORIZE_USER", "INSTALL_APP"].includes(data.nextAction)) throw new Error();
      window.location.assign(data.url);
    } catch { setError("연결을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요."); setBusy(false); }
  }
  const userText = status?.userAuthorization === "AUTHORIZED" ? "사용자 승인 완료" : status?.userAuthorization === "REAUTHORIZE" ? "사용자 재승인 필요" : "사용자 승인 필요";
  const installText = status?.installation === "INSTALLED" ? "설치 확인 완료" : status?.installation === "PENDING_APPROVAL" ? "관리자 승인 대기" : "App 설치 필요";
  return <main className={styles.main} id="main">
    <Link className={styles.back} href="/app/repoq">← 내 프로젝트</Link>
    <p className={styles.eyebrow}>REPOQ / GITHUB APP</p>
    <h1><GitHubMark size={28} /> GitHub App 연결 관리</h1>
    <p className={styles.lead}>GitHub App 승인과 설치 상태를 확인합니다. Public Repository 프로젝트는 App 연결 없이도 URL로 만들 수 있습니다. DevField 로그인에 사용하는 GitHub 계정 연결과는 별개입니다.</p>
    {result && messages[result] && <p className={styles.notice} role="status">{messages[result]}</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    <section className={styles.card} aria-labelledby="connection-title">
      <div className={styles.heading}><div><p className={styles.eyebrow}>01 / CONNECTION</p><h2 id="connection-title">GitHub App 연결 상태</h2></div>
        <button type="button" onClick={start} disabled={busy || !status}>{busy ? "연결 준비 중…" : status?.userAuthorization === "AUTHORIZED" && status.installation === "INSTALLED" ? "GitHub App 설치·권한 관리" : status?.userAuthorization === "AUTHORIZED" ? "GitHub App 설치 또는 승인 확인" : "GitHub App 연결"}</button></div>
      {!status ? <p role="status">{error ? "연결 상태를 확인할 수 없습니다." : "연결 상태를 불러오는 중입니다…"}</p> : <div className={styles.states}>
        <div><span>사용자 승인</span><strong>{userText}</strong></div><div><span>App 설치</span><strong>{installText}</strong></div>
      </div>}
      {status?.installation === "PENDING_APPROVAL" && <p className={styles.hint}>조직 관리자의 승인이 필요합니다. 승인 후 새 설치 시도를 시작해 주세요.</p>}
    </section>
    <section className={styles.card} aria-labelledby="repo-title"><div className={styles.heading}><div><p className={styles.eyebrow}>02 / REPOSITORIES</p><h2 id="repo-title">접근 가능한 Repository</h2></div></div>
      {!listing ? <p role="status">{error ? "Repository를 확인할 수 없습니다." : "Repository를 불러오는 중입니다…"}</p> : listing.status !== "CONNECTED" ?
        <p className={styles.hint}>{listing.status === "INSTALLATION_PENDING" ? "관리자 승인을 기다리고 있습니다." : listing.status === "INSTALLATION_REQUIRED" ? "App 설치가 필요합니다." : "GitHub 사용자 승인이 필요합니다."}</p> :
        <>{listing.repositories.length ? <ul className={styles.repos}>{listing.repositories.map(repo => <li key={repo.id}><GitHubMark size={16} /><span><strong>{repo.fullName}</strong><small>ID {repo.id}</small></span><span className={styles.visibility}>{repo.private ? "Private · 등록 준비 중" : "Public"}</span></li>)}</ul> : <p className={styles.hint}>현재 접근 가능한 Repository가 없습니다.</p>}
          <div className={styles.pagination}><button disabled={listing.page <= 1} onClick={() => void load(listing.page - 1)}>이전</button><span>{listing.page} 페이지</span><button disabled={!listing.hasNext} onClick={() => void load(listing.page + 1)}>다음</button></div></>}
    </section>
  </main>;
}
