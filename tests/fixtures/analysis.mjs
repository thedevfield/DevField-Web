export const projectId = "11111111-1111-4111-8111-111111111111";
const uuid = n => String(n).padStart(8, "0") + "-1111-4111-8111-111111111111";
export function readyDetail(count = 1) {
  const members = Array.from({ length: count }, (_, i) => ({ memberId: uuid(10 + i), repositoryId: uuid(30 + i),
    githubRepositoryId: String(72 + i), commitSha: "a".repeat(40) }));
  const evidenceReferences = members.flatMap((m, i) => [
    { ...m, id: uuid(50 + i), filePath: "src/App.java", lineStart: 3, lineEnd: 5,
      claimType: "CODE_FACT", summary: "Declares a Spring REST controller." },
    { ...m, id: uuid(80 + i), filePath: "README.md", lineStart: null, lineEnd: null,
      claimType: "DOC_CLAIM", summary: "Documentation mentions a technology." },
  ]);
  return { id: projectId, name: "Workspace", projectStatus: "ACTIVE", analysisStatus: "READY",
    canInterview: false, canPrivateInterview: false, membershipVersion: 1,
    repositories: members.map(m => ({ id: m.repositoryId, githubRepositoryId: m.githubRepositoryId, fullName: "org/repo" + m.githubRepositoryId,
      visibility: "PUBLIC", accessStatus: "ACTIVE", analysisStatus: "READY", commitSha: m.commitSha })),
    latestReadySnapshot: { snapshotId: uuid(1), membershipVersion: 1, members, topics: ["API_BACKEND"], relations: [],
      coverage: members.map(m => ({ memberId: m.memberId, collectedFiles: 2, skippedFiles: 3,
        selectedPaths: ["src/App.java", "README.md"], exclusions: { unsupported_file: 3 } })), evidenceReferences } };
}
export function blockedDetail() {
  const value = readyDetail();
  value.analysisStatus = "FAILED"; value.name = "Public access unavailable"; value.latestReadySnapshot = null;
  value.repositories = value.repositories.map(m => ({ ...m, accessStatus: "BLOCKED", analysisStatus: "FAILED",
    githubRepositoryId: null, fullName: null, commitSha: null }));
  return value;
}
