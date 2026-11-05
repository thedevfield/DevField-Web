export type ClaimType = "CODE_FACT" | "DOC_CLAIM" | "HYPOTHESIS";
export type SnapshotMember = { memberId: string; repositoryId: string; githubRepositoryId: string; commitSha: string };
export type Evidence = SnapshotMember & { id: string; filePath: string; lineStart: number | null;
  lineEnd: number | null; claimType: ClaimType; summary: string };
export type Relation = { fromMemberId: string; toMemberId: string; claimType: ClaimType; evidenceIds: string[]; summary: string };
export type Coverage = { memberId: string; collectedFiles: number; skippedFiles: number;
  selectedPaths: string[]; exclusions: Record<string, number> };
export type AnalysisSnapshot = { snapshotId: string; membershipVersion: number; members: SnapshotMember[];
  topics: string[]; relations: Relation[]; coverage: Coverage[]; evidenceReferences: Evidence[] };
