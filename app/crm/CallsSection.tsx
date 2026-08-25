"use client";

import { useState } from "react";
import type { CrmCall } from "../../db/crm";

/**
 * Tracked calls, as somebody working a lead needs to read them.
 *
 * Used in two places for the same reason a contact and a lead are two things:
 * one person can ring about several jobs, so the contact shows every call they
 * ever made while a lead shows only the calls that belong to that job.
 */

function duration(seconds: number | null) {
  if (seconds == null || seconds < 0) return "—";
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes ? `${minutes}m ${rest}s` : `${rest}s`;
}

function when(value: string | null) {
  if (!value) return "Unknown time";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return "Unknown time";
  return at.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function phone(value: string | null) {
  if (!value) return "—";
  const digits = value.replace(/\D/gu, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return value;
}

const CLASSIFICATIONS: Record<string, string> = {
  new_sales_inquiry: "New enquiry",
  existing_customer: "Existing customer",
  spam: "Not a lead",
};

function RecordingPlayer({
  call,
  clientId,
}: {
  call: CrmCall;
  clientId: string;
}) {
  const [failed, setFailed] = useState(false);

  // Nothing to play, and the row says so plainly rather than showing a player
  // that will not start. Plenty of calls simply have no recording.
  if (!call.recordingAvailable || failed) {
    return (
      <p className="crm-call-recording-empty">
        Recording unavailable
        {call.recordingAvailable && failed ? " — it could not be played." : "."}
      </p>
    );
  }

  // The src is this server, never CallRail: the audio is fetched with the
  // customer's API key on the far side of a permission check, and the browser
  // is never handed a URL that would work without one.
  return (
    <audio
      className="crm-call-recording"
      controls
      preload="none"
      onError={() => setFailed(true)}
      src={`/api/callrail/recordings/${encodeURIComponent(
        call.callrailCallId,
      )}?clientId=${encodeURIComponent(clientId)}`}
    >
      Your browser cannot play this recording.
    </audio>
  );
}

function CallRow({ call, clientId }: { call: CrmCall; clientId: string }) {
  const [openTranscript, setOpenTranscript] = useState(false);
  const answered = call.answered === true;
  const missed = call.answered === false;

  return (
    <article className="crm-call-row">
      <header>
        <div>
          <strong>{when(call.startedAt)}</strong>
          <span
            className={`crm-call-status${
              missed ? " crm-call-status-missed" : ""
            }`}
          >
            {answered ? "Answered" : missed ? "Missed" : "Unknown"}
          </span>
          {call.direction ? (
            <span className="crm-call-chip">{call.direction}</span>
          ) : null}
          {call.classification ? (
            <span className="crm-call-chip">
              {CLASSIFICATIONS[call.classification] ?? call.classification}
            </span>
          ) : null}
        </div>
        <span className="crm-call-duration">{duration(call.durationSeconds)}</span>
      </header>

      <dl className="crm-call-facts">
        <div>
          <dt>Tracking number</dt>
          <dd>{phone(call.trackingPhoneNumber)}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{call.source ?? "Unknown"}</dd>
        </div>
      </dl>

      {call.callSummary ? (
        <p className="crm-call-summary">{call.callSummary}</p>
      ) : null}

      <RecordingPlayer call={call} clientId={clientId} />

      {call.transcript ? (
        <div className="crm-call-transcript">
          <button
            type="button"
            aria-expanded={openTranscript}
            onClick={() => setOpenTranscript((open) => !open)}
          >
            {openTranscript ? "Hide transcript" : "Show full transcript"}
          </button>
          {openTranscript ? <pre>{call.transcript}</pre> : null}
        </div>
      ) : (
        <p className="crm-call-recording-empty">No transcript for this call.</p>
      )}
    </article>
  );
}

export function CallsSection({
  calls,
  clientId,
  emptyMessage,
}: {
  calls: CrmCall[];
  clientId: string;
  emptyMessage: string;
}) {
  // Newest first, and a call with no start time sorts last rather than
  // disappearing: it still happened.
  const ordered = [...calls].sort((a, b) =>
    (b.startedAt ?? "").localeCompare(a.startedAt ?? ""),
  );

  return (
    <section className="crm-drawer-block crm-calls-section">
      <h4>
        Calls
        {ordered.length ? <span> · {ordered.length}</span> : null}
      </h4>
      {ordered.length ? (
        <div className="crm-call-list">
          {ordered.map((call) => (
            <CallRow key={call.id} call={call} clientId={clientId} />
          ))}
        </div>
      ) : (
        <p className="crm-connection-note">{emptyMessage}</p>
      )}
    </section>
  );
}
