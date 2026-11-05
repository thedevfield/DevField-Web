"use client";
import { useEffect, useRef, useState } from "react";
import { csrfToken, responseData } from "./project-ui";
import { consentDecisions, type ConsentStatus, type Purpose, type Decision } from "./consents";
import styles from "./workspace.module.css";

const label = (purpose: Purpose) => purpose === "PRIVATE_COLLECTION" ? "수집·분석" : "외부 AI 처리";
const description = (decision: ConsentStatus["consents"][number]["decision"]) =>
  decision === "GRANTED" ? "동의함" : decision === "DENIED" ? "거부함" : decision === "REVOKED" ? "철회됨" : "미결정";

export function ConsentManager({ repositoryId, privateEnabled }: { repositoryId: string; privateEnabled: boolean }) {
  const [state, setState] = useState<ConsentStatus>();
  const [collection, setCollection] = useState<Decision>("");
  const [ai, setAi] = useState<Decision>("");
  const [target, setTarget] = useState<Purpose | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  async function load() {
    setState(undefined); setCollection(""); setAi(""); setError("");
    try { setState(await responseData(await fetch(`/api/github/repositories/${repositoryId}/consents`, { cache: "no-store" }))); }
    catch { setState(undefined); setError("저장된 동의 상태를 확인할 수 없습니다."); }
  }
  useEffect(() => { void load(); }, [repositoryId]);

  async function send(consents: { purpose: Purpose; decision: Exclude<Decision, "">; policyVersion: string | null }[]) {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/github/repositories/${repositoryId}/consents`, { method: "PUT", cache: "no-store",
        headers: { "Content-Type": "application/json", "x-devfield-csrf": await csrfToken() }, body: JSON.stringify({ consents }) });
      if (response.status === 401) { window.location.assign("/login"); return; }
      const result = await responseData(response);
      setNotice(response.status === 202 ? consents.length === 1 ? `철회가 접수되었습니다. 참조 ID ${result.revocationId}` :
        `동의 상태가 갱신되었습니다. 기존 철회 참조 ID ${result.revocationId}` : "동의 상태가 갱신되었습니다.");
      setCollection(""); setAi(""); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "동의 상태를 변경하지 못했습니다."); }
    finally { setBusy(false); }
  }

  function previous(purpose: Purpose) { return state?.consents.find(c => c.purpose === purpose); }
  function grantAllowed(purpose: Purpose) {
    const prior = previous(purpose);
    return prior?.decision !== "REVOKED" || prior.cleanupState === "NO_DERIVED_DATA";
  }
  function grantOptionDisabled(purpose: Purpose) {
    const prior = previous(purpose);
    return !grantAllowed(purpose) || !privateEnabled && (prior?.decision !== "GRANTED" || prior.policyVersion !== state?.currentPolicyVersion);
  }
  async function submit() {
    if (!state?.consentSubmissionAvailable || !state.currentPolicyVersion || !collection || !ai) {
      setError("현재 정책 버전과 두 목적의 결정을 확인해 주세요."); return;
    }
    const decisions: [Purpose, Exclude<Decision, "">][] = [["PRIVATE_COLLECTION", collection], ["EXTERNAL_AI", ai]];
    if (decisions.some(([purpose, decision]) => decision === "REVOKED" && previous(purpose)?.decision !== "REVOKED" ||
        decision === "DENIED" && ["GRANTED", "REVOKED"].includes(previous(purpose)?.decision ?? "") ||
        decision === "GRANTED" && grantOptionDisabled(purpose))) {
      setError("현재 상태에서는 선택한 결정을 제출할 수 없습니다."); return;
    }
    try { await send(consentDecisions(state, collection, ai)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "동의 상태를 다시 확인해 주세요."); }
  }
  async function revoke() {
    if (!target || !["GRANTED", "REVOKED"].includes(previous(target)?.decision ?? "")) return;
    dialog.current?.close();
    await send([{ purpose: target, decision: "REVOKED", policyVersion: null }]);
    setTarget(null);
  }
  const choices: { purpose: Purpose; value: Decision; set: (value: Decision) => void }[] = [
    { purpose: "PRIVATE_COLLECTION", value: collection, set: setCollection },
    { purpose: "EXTERNAL_AI", value: ai, set: setAi },
  ];
  return <div className={`${styles.card} ${styles.consentCard}`}>
    <h3>Repository ID {repositoryId} 동의</h3>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    {!state ? <button type="button" className={styles.secondary} onClick={() => void load()}>동의 상태 다시 조회</button> : <>
      <p className={styles.help}>현재 정책 버전: {state.currentPolicyVersion ?? "미설정"}</p>
      {state.consents.map(consent => <div key={consent.purpose}>
        <p className={styles.help}>{label(consent.purpose)}: {description(consent.decision)} · 기록 버전 {consent.policyVersion ?? "없음"}
          {consent.policyVersion && consent.policyVersion !== state.currentPolicyVersion ? " (이전 버전)" : ""}</p>
        {consent.decision === "REVOKED" && <p className={styles.help}>정리 상태: {consent.cleanupState === "NO_DERIVED_DATA" ? "파생 데이터 없음 · 현재 정책과 GitHub 권한 확인 후 재동의 가능" : "정리 확인 전 · 재동의 제한"}</p>}
        {["GRANTED", "REVOKED"].includes(consent.decision ?? "") && <button type="button" className={styles.secondary} disabled={busy}
          onClick={() => { setTarget(consent.purpose); dialog.current?.showModal(); }}>{label(consent.purpose)} 동의 철회</button>}
      </div>)}
      {!state.consentSubmissionAvailable && <p role="status" className={styles.help}>현재 정책 버전이 없어 신규 동의·거부는 제출할 수 없습니다. 기존 동의 철회는 가능합니다.</p>}
      {state.consentSubmissionAvailable && <>
        <p className={styles.help}>새 결정은 현재 정책 버전을 사용합니다. 과거 동의는 자동 갱신하지 않습니다. 두 목적의 결정을 각각 명시적으로 선택해 주세요. Private 코드 사용에는 GitHub App 연결과 Repository 접근 권한도 필요합니다.</p>
        {choices.map(choice => <label key={choice.purpose}>{label(choice.purpose)} 결정 <select value={choice.value} disabled={busy} onChange={event => choice.set(event.target.value as Decision)}>
          <option value="">선택</option>
          <option value="GRANTED" disabled={grantOptionDisabled(choice.purpose)}>동의</option>
          <option value="DENIED" disabled={["GRANTED", "REVOKED"].includes(previous(choice.purpose)?.decision ?? "")}>거부</option>
          {previous(choice.purpose)?.decision === "REVOKED" && <option value="REVOKED">철회 상태 유지</option>}
        </select></label>)}
        <button type="button" className={styles.primary} disabled={busy || !collection || !ai} onClick={() => void submit()}>{busy ? "처리 중…" : "결정 저장"}</button>
      </>}
    </>}
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="revoke-title" aria-describedby="revoke-description" onClose={() => setTarget(null)}>
      <h3 id="revoke-title">{target && label(target)} 동의를 철회할까요?</h3>
      <p id="revoke-description">선택한 목적의 동의만 철회합니다. 다른 목적의 결정과 정책 버전은 변경하지 않습니다. Private 접근이나 외부 AI 처리에 영향이 있을 수 있습니다.</p>
      <div className={styles.actions}><button type="button" className={styles.danger} disabled={busy} onClick={() => void revoke()}>철회</button>
        <button type="button" className={styles.secondary} disabled={busy} onClick={() => dialog.current?.close()}>취소</button></div>
    </dialog>
  </div>;
}
