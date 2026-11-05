"use client";
import Link from "next/link";
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { responseData } from "./project-ui";
import styles from "./workspace.module.css";

export type ConsentDecision = "GRANTED" | "DENIED";
export type ConsentStatus = { githubRepositoryId: string; currentPolicyVersion: string | null; consentSubmissionAvailable: boolean;
  consents: { purpose: "PRIVATE_COLLECTION" | "EXTERNAL_AI"; decision: ConsentDecision | "REVOKED" | null; policyVersion: string | null }[] };
export type Choice = { id: string; name: string; status: ConsentStatus | null; collection: ConsentDecision | ""; ai: ConsentDecision | ""; error: string };
type Listing = { status: string; repositories: { id: number; fullName: string; private: boolean }[]; page: number; hasNext: boolean };

export function privateEntries(choices: Choice[]) {
  return choices.map(choice => {
    if (!choice.status?.consentSubmissionAvailable || !choice.status.currentPolicyVersion || choice.collection !== "GRANTED" || !choice.ai)
      throw new Error("Private Repository의 현재 정책과 두 목적의 결정을 확인해 주세요.");
    return { githubRepositoryId: choice.id, consents: [
      { purpose: "PRIVATE_COLLECTION", decision: choice.collection, policyVersion: choice.status.currentPolicyVersion },
      { purpose: "EXTERNAL_AI", decision: choice.ai, policyVersion: choice.status.currentPolicyVersion },
    ] };
  });
}

export function PrivateRepositoryPicker({ enabled, disabled, choices, onChange }: { enabled: boolean; disabled: boolean; choices: Choice[]; onChange: Dispatch<SetStateAction<Choice[]>> }) {
  const [listing, setListing] = useState<Listing>();
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setListing(undefined);
    fetch(`/api/github/repositories?page=${page}`, { cache: "no-store" }).then(responseData).then(data => {
      if (active) { setListing(data); setError(""); if (data.status !== "CONNECTED") onChange([]); }
    }).catch(() => { if (active) { setListing(undefined); onChange([]); setError("GitHub Repository를 불러올 수 없습니다."); } });
    return () => { active = false; };
  }, [enabled, page, onChange]);
  async function toggle(repo: Listing["repositories"][number]) {
    const id = String(repo.id);
    if (choices.some(choice => choice.id === id)) { onChange(current => current.filter(choice => choice.id !== id)); return; }
    const next: Choice = { id, name: repo.fullName, status: null, collection: "", ai: "", error: "" };
    onChange(current => [...current, next]);
    try {
      const status = await responseData(await fetch(`/api/github/repositories/${id}/consents`, { cache: "no-store" })) as ConsentStatus;
      onChange(current => current.map(choice => choice.id === id ? { ...choice, status } : choice));
    } catch { onChange(current => current.map(choice => choice.id === id ? { ...choice, error: "동의 상태를 확인할 수 없습니다. 다시 선택해 주세요." } : choice)); }
  }
  function decide(id: string, field: "collection" | "ai", decision: ConsentDecision) {
    onChange(current => current.map(choice => choice.id === id ? { ...choice, [field]: decision } : choice));
  }
  if (!enabled) return <p className={styles.help}>Private Repository 등록은 준비 중입니다. Public URL은 계속 등록할 수 있습니다.</p>;
  return <fieldset className={styles.fields} disabled={disabled}>
    <legend>Private Repository 선택</legend>
    <p className={styles.help}>GitHub App 접근과 현재 동의 정책이 확인된 Repository만 등록할 수 있습니다. <Link href="/app/repoq/settings/github">GitHub App 연결 관리</Link></p>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {listing?.status !== "CONNECTED" ? <p className={styles.help}>{listing ? "GitHub App 연결 또는 설치 승인이 필요합니다." : "접근 가능한 Repository를 확인하는 중입니다."}</p> : <>
      {listing.repositories.filter(repo => repo.private).map(repo => <label className={styles.privateChoice} key={repo.id}>
        <input type="checkbox" checked={choices.some(choice => choice.id === String(repo.id))} onChange={() => void toggle(repo)} />{repo.fullName}
      </label>)}
      {!listing.repositories.some(repo => repo.private) && <p className={styles.help}>이 페이지에 접근 가능한 Private Repository가 없습니다.</p>}
      <div className={styles.actions}><button type="button" className={styles.secondary} disabled={page === 1} onClick={() => setPage(page - 1)}>이전</button>
        <span>{page} 페이지</span><button type="button" className={styles.secondary} disabled={!listing.hasNext} onClick={() => setPage(page + 1)}>다음</button></div>
    </>}
    {choices.map(choice => <div className={styles.card} key={choice.id}>
      <strong>{choice.name}</strong>
      {choice.error && <p role="alert" className={styles.error}>{choice.error}</p>}
      {!choice.status && !choice.error && <p role="status">동의 상태를 확인하는 중입니다…</p>}
      {choice.status && <>
        <p className={styles.help}>현재 정책 버전: {choice.status.currentPolicyVersion ?? "미설정"}</p>
        {choice.status.consents.map(consent => <p className={styles.help} key={consent.purpose}>{consent.purpose === "PRIVATE_COLLECTION" ? "수집·분석" : "외부 AI 처리"}: {consent.decision ?? "미결정"} · 기록 버전 {consent.policyVersion ?? "없음"}{consent.policyVersion && consent.policyVersion !== choice.status?.currentPolicyVersion ? " (이전 버전)" : ""}</p>)}
        {!choice.status.consentSubmissionAvailable ? <p role="status" className={styles.help}>현재 정책 버전이 설정되지 않아 신규 동의를 제출할 수 없습니다.</p> : <>
          <fieldset><legend>Private 코드 수집·분석 동의</legend><label><input type="radio" name={`collection-${choice.id}`} checked={choice.collection === "GRANTED"} onChange={() => decide(choice.id, "collection", "GRANTED")} /> 동의</label><label><input type="radio" name={`collection-${choice.id}`} checked={choice.collection === "DENIED"} onChange={() => decide(choice.id, "collection", "DENIED")} /> 거부</label></fieldset>
          <fieldset><legend>Private 코드를 외부 AI 모델로 처리하는 데 동의</legend><label><input type="radio" name={`ai-${choice.id}`} checked={choice.ai === "GRANTED"} onChange={() => decide(choice.id, "ai", "GRANTED")} /> 동의</label><label><input type="radio" name={`ai-${choice.id}`} checked={choice.ai === "DENIED"} onChange={() => decide(choice.id, "ai", "DENIED")} /> 거부</label></fieldset>
        </>}
      </>}
    </div>)}
  </fieldset>;
}
