"use client";

import { MessageCircle } from "lucide-react";
import type { CrmCall } from "../../db/crm";
import { parseCallTranscript } from "../../lib/callrail-transcript";

function dateTime(value: string | null) {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unknown";
  return parsed.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function duration(seconds: number | null) {
  if (seconds == null || seconds < 0) return "Unknown";
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes ? `${minutes}m ${remainder}s` : `${remainder}s`;
}

function unavailableCopy(status: string | null) {
  switch (status?.toLowerCase()) {
    case "pending":
    case "processing":
    case "requested":
      return "This transcript is still processing. BrizBuilder will retry automatically.";
    case "failed":
      return "Transcript processing failed. BrizBuilder will keep the call available for retry.";
    case "unavailable":
      return "This provider did not make a transcript available for this call.";
    default:
      return "A transcript is not available yet.";
  }
}

function unavailableHeading(status: string | null) {
  switch (status?.toLowerCase()) {
    case "pending":
    case "processing":
    case "requested":
      return "Transcript processing";
    case "failed":
      return "Transcript processing failed";
    case "unavailable":
      return "Transcript unavailable";
    default:
      return "Transcript not available yet";
  }
}

/** The single transcript/recording presentation shared by Leads and Calls. */
export function CallTranscriptCard({
  call,
  clientId,
  customerInitials,
  eyebrow = "Call",
}: {
  call: CrmCall;
  clientId: string;
  customerInitials: string;
  eyebrow?: string;
}) {
  const lines = parseCallTranscript(call.transcript);
  const recordingCallId = call.provider === "callrail" ? call.callrailCallId : "";

  return (
    <section className="crm-lead-section-card crm-lead-transcript-card">
      <header className="crm-lead-section-heading">
        <div>
          <span>{eyebrow}</span>
          <h3>Call transcript</h3>
        </div>
        <p>Read-only transcript view</p>
      </header>

      <div className="crm-lead-call-meta">
        <div><span>Call started</span><strong>{dateTime(call.startedAt)}</strong></div>
        <div><span>Duration</span><strong>{duration(call.durationSeconds)}</strong></div>
        <div><span>Recording</span><strong>{call.recordingAvailable ? "Available" : "Unavailable"}</strong></div>
      </div>

      {call.recordingAvailable && recordingCallId ? (
        <audio
          className="crm-lead-recording"
          controls
          preload="none"
          src={`/api/callrail/recordings/${encodeURIComponent(
            recordingCallId,
          )}?clientId=${encodeURIComponent(clientId)}`}
        >
          Your browser cannot play this recording.
        </audio>
      ) : null}

      {call.callSummary ? (
        <div className="crm-lead-call-summary">
          <strong>Call summary</strong>
          <p>{call.callSummary}</p>
        </div>
      ) : null}

      {lines.length ? (
        <div className="crm-lead-conversation">
          {lines.map((line, lineIndex) => (
            <article
              aria-label={`${line.speaker} message`}
              className={line.role}
              key={`${lineIndex}-${line.role}-${line.text.slice(0, 20)}`}
            >
              {line.role !== "agent" ? (
                <span>{line.role === "caller" ? customerInitials.slice(0, 1) : "T"}</span>
              ) : null}
              <div><strong>{line.speaker}</strong><p>{line.text}</p></div>
              {line.role === "agent" ? <span>A</span> : null}
            </article>
          ))}
        </div>
      ) : (
        <div className="crm-lead-empty-tab compact">
          <MessageCircle aria-hidden="true" />
          <h3>{unavailableHeading(call.transcriptStatus)}</h3>
          <p>{unavailableCopy(call.transcriptStatus)}</p>
        </div>
      )}
    </section>
  );
}
