export type InterviewMode = "FREE" | "MOCK";
export type InterviewStatus = "PREPARING" | "ACTIVE" | "GENERATION_FAILED" | "PAUSED" | "ENDED" | "EVALUATING" | "COMPLETED";
export type InterviewItem = { interviewId: string; mode: InterviewMode; status: InterviewStatus; completedBundles: number; createdAt: string };
export type InterviewHistory = { items: InterviewItem[]; nextCursor: string | null };
export type InterviewAnswer = { questionId: string; question: string; answer: string };
export type InterviewEvaluation = { evidenceId: string; strengths: string; gaps: string; improvements: string; exampleAnswer: string; keyPoints: string; limitations: string };
export type InterviewSummary = { strengths: string; gaps: string; consistency: string; studyAreas: string; limitations: string };
export type InterviewBundle = { bundleId: string; sequence: number; topicKey: string; answers: InterviewAnswer[]; evaluation: InterviewEvaluation };
export type InterviewDetail = Omit<InterviewItem, "createdAt"> & {
  snapshotId: string; topicKey: string | null; currentQuestion?: { id: string; text: string; topicKey: string };
  answers?: InterviewAnswer[]; answerProgress?: "AWAITING_ANSWER" | "FOLLOW_UP_PENDING" | "QUESTIONS_COMPLETE" | "FOLLOW_UP_FAILED" | "FOLLOW_UP_CANCELLED";
  evaluationStatus?: "PENDING" | "READY" | "FAILED" | "CANCELLED"; evaluation?: InterviewEvaluation;
  currentBundleId?: string; completedBundleHistory?: InterviewBundle[]; sessionEvaluation?: InterviewSummary;
};
