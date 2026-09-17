import type { CrmCall } from "../db/crm";

/**
 * The answered state a provider status implies, for rows without an explicit
 * `answered` flag. Stored rows use "missed" alongside Twilio's no-answer, busy,
 * failed and canceled. Leaving "missed" out made those calls neither missed nor
 * answered, so the Calls summary disagreed with its own table and with the
 * Dashboard, which already treats every one of these as missed.
 */
export function answeredFromCallStatus(status: string | null | undefined): boolean | null {
  const normalized = (status ?? "").trim().toLowerCase().replaceAll("_", "-");
  if (["completed", "in-progress", "answered"].includes(normalized)) return true;
  if (
    normalized.includes("missed") ||
    ["no-answer", "busy", "failed", "canceled", "cancelled"].includes(normalized)
  ) {
    return false;
  }
  return null;
}

export function isInboundCall(call: CrmCall) {
  return (call.direction ?? "inbound").toLowerCase() !== "outbound";
}

export function isMissedCall(call: CrmCall) {
  return isInboundCall(call) && call.answered === false;
}

export function isAnsweredCall(call: CrmCall) {
  return call.answered === true;
}

/** A missed call stops needing attention after a later successful conversation. */
export function callNeedsFollowUp(call: CrmCall, allCalls: CrmCall[]) {
  if (!isMissedCall(call) || call.handledAt) return false;
  const startedAt = Date.parse(call.startedAt ?? "");
  return !allCalls.some(
    (candidate) =>
      candidate.id !== call.id &&
      candidate.clientId === call.clientId &&
      candidate.customerPhone === call.customerPhone &&
      isAnsweredCall(candidate) &&
      Date.parse(candidate.startedAt ?? "") > startedAt,
  );
}
