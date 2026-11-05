"use client";
import { useEffect, useState } from "react";
import { csrfToken, responseData } from "./project-ui";
import type { ConsentDecision, ConsentStatus } from "./PrivateRepositoryPicker";
import styles from "./workspace.module.css";

type Decision = ConsentDecision | "REVOKED" | "";
export function ConsentManager({ repositoryId, privateEnabled }: { repositoryId: string; privateEnabled: boolean }) {
  const [state, setState] = useState<ConsentStatus>();
  const [collection, setCollection] = useState<Decision>("");
  const [ai, setAi] = useState<Decision>("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    setError("");
    try { setState(await responseData(await fetch(`/api/github/repositories/${repositoryId}/consents`, { cache: "no-store" }))); }
    catch { setState(undefined); setError("저장된 동의 상태를 확인할 수 없습니다."); }
  }
  useEffect(() => { void load(); }, [repositoryId]);
  async function submit() {
    if (!state?.consentSubmissionAvailable || !state.currentPolicyVersion || !collection || !ai) { setError("두 목적의 결정을 모두 선택해 주세요."); return; }
    const previous = Object.fromEntries(state.consents.map(c => [c.purpose, c.decision]));
    if ((previous.PRIVATE_COLLECTION === "GRANTED" && collection === "DENIED") || (previous.EXTERNAL_AI === "GRANTED" && ai === "DENIED")) {
      setError("기존 동의는 거부로 변경할 수 없습니다. 철회를 선택해 주세요."); return;
    }
    if ((collection === "REVOKED" && !["GRANTED", "REVOKED"].includes(previous.PRIVATE_COLLECTION ?? "")) ||
        (ai === "REVOKED" && !["GRANTED", "REVOKED"].includes(previous.EXTERNAL_AI ?? "")) ||
        (previous.PRIVATE_COLLECTION === "REVOKED" && collection === "GRANTED") ||
        (previous.EXTERNAL_AI === "REVOKED" && ai === "GRANTED")) {
      setError("현재 철회 상태에서는 이 결정을 제출할 수 없습니다."); return;
    }
    if (!privateEnabled && (collection === "GRANTED" && !(previous.PRIVATE_COLLECTION === "GRANTED" && state.consents.find(c => c.purpose === "PRIVATE_COLLECTION")?.policyVersion === state.currentPolicyVersion) ||
        ai === "GRANTED" && !(previous.EXTERNAL_AI === "GRANTED" && state.consents.find(c => c.purpose === "EXTERNAL_AI")?.policyVersion === state.currentPolicyVersion))) {
      setError("Private 등록 기능이 비활성인 동안 새 동의는 제출할 수 없습니다."); return;
    }
    setBusy(true); setError(""); setNotice("");
    try {
      const body = { consents: [
        { purpose: "PRIVATE_COLLECTION", decision: collection, policyVersion: state.currentPolicyVersion },
        { purpose: "EXTERNAL_AI", decision: ai, policyVersion: state.currentPolicyVersion },
      ] };
      const response = await fetch(`/api/github/repositories/${repositoryId}/consents`, { method: "PUT", cache: "no-store",
        headers: { "Content-Type": "application/json", "x-devfield-csrf": await csrfToken() }, body: JSON.stringify(body) });
      if (response.status === 401) { window.location.assign("/login"); return; }
      const result = await responseData(response);
      setNotice(response.status === 202 ? `철회가 접수되었습니다. 참조 ID ${result.revocationId}` : "동의 상태가 갱신되었습니다.");
      setCollection(""); setAi(""); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "동의 상태를 변경하지 못했습니다."); }
    finally { setBusy(false); }
  }
  const previous = Object.fromEntries(state?.consents.map(c => [c.purpose, c]) ?? []) as Record<string, ConsentStatus["consents"][number]>;
  return <div className={`${styles.card} ${styles.consentCard}`}>
    <h3>Repository ID {repositoryId} 동의</h3>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    {!state ? <button type="button" className={styles.secondary} onClick={() => void load()}>동의 상태 다시 조회</button> : <>
      <p className={styles.help}>현재 정책 버전: {state.currentPolicyVersion ?? "미설정"}</p>
      {state.consents.map(c => <p className={styles.help} key={c.purpose}>{c.purpose === "PRIVATE_COLLECTION" ? "수집·분석" : "외부 AI 처리"}: {c.decision ?? "미결정"} · 기록 버전 {c.policyVersion ?? "없음"}{c.policyVersion && c.policyVersion !== state.currentPolicyVersion ? " (이전 버전)" : ""}</p>)}
      {!state.consentSubmissionAvailable ? <p role="status">현재 정책 버전이 설정되지 않아 신규 결정을 제출할 수 없습니다. 저장된 상태는 확인할 수 있습니다.</p> : <>
        <p className={styles.help}>변경할 때는 두 목적 모두 선택하세요. 수집·분석은 Private 코드 접근, 외부 AI는 Private 코드를 외부 모델로 처리하는 결정입니다.</p>
        <label>수집·분석 결정 <select value={collection} disabled={busy} onChange={event => setCollection(event.target.value as Decision)}>
          <option value="">선택</option><option value="GRANTED" disabled={previous.PRIVATE_COLLECTION?.decision === "REVOKED" || !privateEnabled && !(previous.PRIVATE_COLLECTION?.decision === "GRANTED" && previous.PRIVATE_COLLECTION.policyVersion === state.currentPolicyVersion)}>동의</option>
          <option value="DENIED" disabled={previous.PRIVATE_COLLECTION?.decision === "GRANTED"}>거부</option>
          <option value="REVOKED" disabled={!["GRANTED", "REVOKED"].includes(previous.PRIVATE_COLLECTION?.decision ?? "")}>철회</option>
        </select></label>
        <label>외부 AI 처리 결정 <select value={ai} disabled={busy} onChange={event => setAi(event.target.value as Decision)}>
          <option value="">선택</option><option value="GRANTED" disabled={previous.EXTERNAL_AI?.decision === "REVOKED" || !privateEnabled && !(previous.EXTERNAL_AI?.decision === "GRANTED" && previous.EXTERNAL_AI.policyVersion === state.currentPolicyVersion)}>동의</option>
          <option value="DENIED" disabled={previous.EXTERNAL_AI?.decision === "GRANTED"}>거부</option>
          <option value="REVOKED" disabled={!["GRANTED", "REVOKED"].includes(previous.EXTERNAL_AI?.decision ?? "")}>철회</option>
        </select></label>
        <button type="button" className={styles.primary} disabled={busy || !collection || !ai} onClick={() => void submit()}>{busy ? "처리 중…" : "결정 저장"}</button>
      </>}
    </>}
  </div>;
}
