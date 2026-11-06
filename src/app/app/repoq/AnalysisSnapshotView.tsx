import type { AnalysisSnapshot, ClaimType } from "@/lib/repoq-analysis";
import type { Member } from "./project-ui";
import styles from "./workspace.module.css";

const claims: Record<ClaimType, string> = {
  CODE_FACT: "CODE_FACT · 코드에서 확인", DOC_CLAIM: "DOC_CLAIM · 문서의 주장", HYPOTHESIS: "HYPOTHESIS · 미확인 가설",
};
const topics: Record<string, string> = { API_BACKEND: "API / Backend", DATABASE: "데이터베이스", SECURITY: "보안",
  ASYNC: "비동기 처리", EXTERNAL_INTEGRATION: "외부 연동", ERROR_HANDLING: "예외 처리" };

export function AnalysisSnapshotView({ snapshot, repositories, previous }: {
  snapshot: AnalysisSnapshot; repositories: Member[]; previous: boolean;
}) {
  // Never render a retained result against blocked or changed membership.
  if (snapshot.members.length !== repositories.length || repositories.some(r => r.visibility !== "PUBLIC" ||
      r.accessStatus !== "ACTIVE" || !snapshot.members.some(m => m.repositoryId === r.id && m.githubRepositoryId === r.githubRepositoryId))) return null;
  const name = (memberId: string) => {
    const member = snapshot.members.find(m => m.memberId === memberId)!;
    return repositories.find(r => r.id === member.repositoryId)?.fullName ?? "Repository";
  };
  return <section className={styles.card} aria-labelledby="snapshot-title">
    <div className={styles.kicker}>ANALYSIS / EVIDENCE</div>
    <h2 id="snapshot-title">{previous ? "이전 분석 결과" : "코드 기반 분석 결과"}</h2>
    <p className={styles.help}>공개 접근이 확인된 Snapshot입니다. 문서의 주장과 코드에서 확인한 사실을 구분합니다.
      보호 정보는 30초 후 숨겨집니다. 계속 보려면 분석 상태를 다시 확인해 주세요.</p>
    <p className={styles.projectId}>Snapshot · {snapshot.snapshotId}</p>
    <h3>분석 기준 Repository</h3>
    <ul className={styles.evidenceList}>{snapshot.members.map(m => <li key={m.memberId}>
      <strong>{name(m.memberId)}</strong><code className={styles.commit}>Commit · {m.commitSha}</code>
    </li>)}</ul>
    <h3>확인된 기술 분야</h3>
    <ul className={styles.topicList}>{snapshot.topics.map(topic => <li className={styles.badge} key={topic}>{topics[topic] ?? topic}</li>)}</ul>
    <h3>구현·문서 근거</h3>
    <ul className={styles.evidenceList}>{snapshot.evidenceReferences.map(e => <li key={e.id}>
      <span className={styles.claim} data-claim={e.claimType}>{claims[e.claimType]}</span>
      <p>{e.summary}</p><div className={styles.help}>{name(e.memberId)}</div>
      <code>{e.filePath}{e.lineStart === null ? " · 라인 정보 없음" : " · L" + e.lineStart + (e.lineEnd !== e.lineStart ? "–" + e.lineEnd : "")}</code>
      <code className={styles.commit}>{e.commitSha}</code>
    </li>)}</ul>
    <h3>수집 범위와 제한</h3>
    <p className={styles.help}>전체 코드를 분석한 결과가 아닙니다. Job당 최대 40파일·파일당 100KiB·전체 2MiB를 나누어 수집하며,
      Java/Spring 중심으로 확인 가능한 선언만 분석합니다. 제외 파일과 미확인 구문은 구현 부재를 뜻하지 않습니다.</p>
    <ul className={styles.evidenceList}>{snapshot.coverage.map(c => <li key={c.memberId}>
      <strong>{name(c.memberId)}</strong><p>수집 {c.collectedFiles}파일 · 제외 {c.skippedFiles}파일</p>
      {Object.keys(c.exclusions).length > 0 && <ul>{Object.entries(c.exclusions).map(([reason, count]) =>
        <li key={reason}><code>{reason}</code> · {count}</li>)}</ul>}
      <details><summary>수집 경로 ({c.selectedPaths.length})</summary>
        <ul>{c.selectedPaths.map((path, index) => <li key={index}><code>{path}</code></li>)}</ul>
      </details>
    </li>)}</ul>
    <h3>Repository 간 관계</h3>
    {snapshot.relations.length === 0 ? <p className={styles.help}>양쪽 근거로 확인된 관계가 없습니다.</p> :
      <ul className={styles.evidenceList}>{snapshot.relations.map((r, index) => <li key={index}>
        <span className={styles.claim}>{claims[r.claimType]}</span>
        <p>{name(r.fromMemberId)} → {name(r.toMemberId)}</p><p>{r.summary}</p>
        <p className={styles.help}>참조 근거 {r.evidenceIds.length}개</p>
      </li>)}</ul>}
  </section>;
}
