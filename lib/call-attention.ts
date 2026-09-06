import type { CrmCall } from "../db/crm";

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
