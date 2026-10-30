"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { RepositoryFields } from "./RepositoryFields";
import { csrfToken, responseData, urlsOf } from "./project-ui";
import styles from "./workspace.module.css";

export function NewProject() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [rows, setRows] = useState([""]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<{ body: string; key: string } | null>(null);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    setError("");
    let body: string;
    try {
      const trimmed = name.trim();
      if (!trimmed || trimmed.length > 100) throw new Error("프로젝트 이름은 1~100자로 입력해 주세요.");
      body = JSON.stringify({ name: trimmed, repositories: urlsOf(rows) });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "입력 내용을 확인해 주세요."); return; }
    if (pending.current?.body !== body) pending.current = { body, key: crypto.randomUUID() };
    setBusy(true);
    try {
      const csrf = await csrfToken();
      const response = await fetch("/api/repoq/projects", { method: "POST", cache: "no-store",
        headers: { "Content-Type": "application/json", "x-devfield-csrf": csrf, "Idempotency-Key": pending.current.key }, body });
      if (response.status === 401) { window.location.assign("/login"); return; }
      const data = await responseData(response);
      if (typeof data?.id !== "string") throw new Error("프로젝트 응답을 확인할 수 없습니다.");
      pending.current = null;
      router.push(`/app/repoq/projects/${data.id}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "프로젝트를 만들지 못했습니다. 같은 내용으로 다시 시도할 수 있습니다."); }
    finally { setBusy(false); }
  }
  return <main className={styles.main} id="main"><div className={styles.kicker}>REPOQ / NEW PROJECT</div>
    <div className={styles.toolbar}><Link href="/app/repoq">← 내 프로젝트</Link></div>
    <h1>새 프로젝트</h1><p className={styles.lead}>이름을 정하고 공개 Repository를 하나 이상 연결하세요. 분석은 등록 후 대기 상태로 표시됩니다.</p>
    <form className={styles.formCard} onSubmit={event => void submit(event)}>
      <label htmlFor="project-name">프로젝트 이름</label>
      <input id="project-name" value={name} required maxLength={100} disabled={busy} placeholder="예: DevField 면접 준비"
        onChange={event => setName(event.target.value)} />
      <p className={styles.help}>공백을 제외한 1~100자</p>
      <RepositoryFields rows={rows} onChange={setRows} disabled={busy} />
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.actions}><button type="submit" className={styles.primary} disabled={busy}>{busy ? "생성 중…" : "프로젝트 만들기"}</button>
        <Link className={styles.secondary} href="/app/repoq">취소</Link></div>
    </form>
  </main>;
}
