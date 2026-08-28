export const CALLRAIL_TRANSCRIPT_MAX_ATTEMPTS = 10;

export const CALLRAIL_TRANSCRIPT_RETRY_DELAYS_MS = [
  5 * 60 * 1000,
  15 * 60 * 1000,
  30 * 60 * 1000,
  60 * 60 * 1000,
  2 * 60 * 60 * 1000,
  4 * 60 * 60 * 1000,
  8 * 60 * 60 * 1000,
  12 * 60 * 60 * 1000,
  24 * 60 * 60 * 1000,
] as const;

export function decideTranscriptRetry(input: {
  transcriptAvailable: boolean;
  attemptCount: number;
  attemptedAt: Date;
  failureReason?: "retry_limit" | "provider_unavailable";
}) {
  const attempts = Math.max(
    0,
    Math.min(CALLRAIL_TRANSCRIPT_MAX_ATTEMPTS, Math.trunc(input.attemptCount)),
  );
  if (input.transcriptAvailable) {
    return { status: "available" as const, nextAttemptAt: null, failureReason: null };
  }
  if (attempts >= CALLRAIL_TRANSCRIPT_MAX_ATTEMPTS) {
    return {
      status: "unavailable" as const,
      nextAttemptAt: null,
      failureReason: input.failureReason ?? ("retry_limit" as const),
    };
  }
  const delay = CALLRAIL_TRANSCRIPT_RETRY_DELAYS_MS[
    Math.min(attempts - 1, CALLRAIL_TRANSCRIPT_RETRY_DELAYS_MS.length - 1)
  ] ?? CALLRAIL_TRANSCRIPT_RETRY_DELAYS_MS[0];
  return {
    status: "pending" as const,
    nextAttemptAt: new Date(input.attemptedAt.getTime() + delay).toISOString(),
    // Keep the latest closed-vocabulary provider failure visible while the
    // call remains retryable. A successful provider response with no
    // transcript passes no reason and clears it again.
    failureReason: input.failureReason ?? null,
  };
}
