import type { PushSendResult } from "./web-push";

export const PUSH_DELIVERY_LEASE_SECONDS = 5 * 60;
export const PUSH_DELIVERY_RETRY_DELAYS_MS = [
  5 * 60 * 1000,
  15 * 60 * 1000,
  60 * 60 * 1000,
  4 * 60 * 60 * 1000,
] as const;
export const PUSH_DELIVERY_MAX_ATTEMPTS =
  PUSH_DELIVERY_RETRY_DELAYS_MS.length + 1;

export type PushDeliveryCompletion = {
  status: "delivered" | "failed" | "permanently_failed";
  sent: number;
  failed: number;
  nextAttemptAt: string | null;
  errorCode: string | null;
};

function retryable(result: PushSendResult): boolean {
  return (
    !result.expired &&
    (result.status === 0 ||
      result.status === 408 ||
      result.status === 425 ||
      result.status === 429 ||
      result.status >= 500)
  );
}

/** Pure state transition shared by dispatch code and concurrency tests. */
export function completePushDelivery(
  results: readonly PushSendResult[],
  attemptCount: number,
  now = new Date(),
): PushDeliveryCompletion {
  const sent = results.filter(
    (result) => result.status >= 200 && result.status < 300,
  ).length;
  const failed = results.length - sent;
  if (sent > 0 || results.length === 0) {
    return {
      status: "delivered",
      sent,
      failed,
      nextAttemptAt: null,
      errorCode: failed ? "partial_delivery" : null,
    };
  }

  const mayRetry = results.some(retryable);
  const delay = PUSH_DELIVERY_RETRY_DELAYS_MS[attemptCount - 1];
  if (mayRetry && delay != null && attemptCount < PUSH_DELIVERY_MAX_ATTEMPTS) {
    return {
      status: "failed",
      sent: 0,
      failed,
      nextAttemptAt: new Date(now.getTime() + delay).toISOString(),
      errorCode: "push_service_retryable",
    };
  }

  return {
    status: "permanently_failed",
    sent: 0,
    failed,
    nextAttemptAt: null,
    errorCode: mayRetry ? "retry_limit" : "push_service_rejected",
  };
}
