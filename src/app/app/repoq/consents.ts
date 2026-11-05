export type ConsentDecision = "GRANTED" | "DENIED";
export type Purpose = "PRIVATE_COLLECTION" | "EXTERNAL_AI";
export type Decision = ConsentDecision | "REVOKED" | "";
export type ConsentStatus = { githubRepositoryId: string; currentPolicyVersion: string | null; consentSubmissionAvailable: boolean;
  consents: { purpose: Purpose; decision: ConsentDecision | "REVOKED" | null; policyVersion: string | null; cleanupState: string | null }[] };
export type Choice = { id: string; name: string; status: ConsentStatus | null; collection: ConsentDecision | ""; ai: ConsentDecision | ""; error: string };

export function cleanupPending(status: ConsentStatus) {
  return status.consents.some(c => c.decision === "REVOKED" && c.cleanupState !== "NO_DERIVED_DATA");
}

export function consentDecisions(status: ConsentStatus, collection: Decision, ai: Decision) {
  if (!status.consentSubmissionAvailable || !status.currentPolicyVersion || !collection || !ai)
    throw new Error("현재 정책 버전과 두 목적의 결정을 각각 선택해 주세요.");
  return ([ ["PRIVATE_COLLECTION", collection], ["EXTERNAL_AI", ai] ] as const).map(([purpose, decision]) => {
    const prior = status.consents.find(c => c.purpose === purpose);
    if (!prior) throw new Error("동의 상태를 다시 조회해 주세요.");
    if (decision === "REVOKED") {
      if (prior.decision !== "REVOKED") throw new Error("기존 동의 철회 버튼을 사용해 주세요.");
    } else {
      if (prior.decision === "REVOKED" && prior.cleanupState !== "NO_DERIVED_DATA")
        throw new Error("철회 정리를 확인 중입니다. 완료 전에는 새 결정을 제출할 수 없습니다.");
      if (decision === "DENIED" && ["GRANTED", "REVOKED"].includes(prior.decision ?? ""))
        throw new Error("기존 동의를 거부로 바꿀 수 없습니다. 동의 관리에서 해당 목적을 철회해 주세요.");
    }
    return { purpose, decision, policyVersion: decision === "REVOKED" ? null : status.currentPolicyVersion };
  });
}

export async function privateEntries(choices: Choice[], load: (id: string) => Promise<ConsentStatus>) {
  return Promise.all(choices.map(async choice => {
    const prior = choice.status;
    if (!prior || choice.collection !== "GRANTED" || !choice.ai)
      throw new Error("Private Repository의 현재 정책과 두 목적의 결정을 확인해 주세요.");
    const status = await load(choice.id);
    if (status.githubRepositoryId !== choice.id || cleanupPending(status))
      throw new Error("철회 정리를 확인 중입니다. Private 등록·추가는 완료 후 다시 시도해 주세요.");
    if (status.currentPolicyVersion !== prior.currentPolicyVersion || status.consentSubmissionAvailable !== prior.consentSubmissionAvailable ||
        status.consents.length !== prior.consents.length || status.consents.some(c => {
          const old = prior.consents.find(p => p.purpose === c.purpose);
          return !old || c.decision !== old.decision || c.policyVersion !== old.policyVersion || c.cleanupState !== old.cleanupState;
        })) throw new Error("동의 상태가 변경되었습니다. Repository를 다시 선택하고 현재 정책의 결정을 확인해 주세요.");
    return { githubRepositoryId: choice.id, consents: consentDecisions(status, choice.collection, choice.ai) };
  }));
}
