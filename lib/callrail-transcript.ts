const MAX_TRANSCRIPT_LENGTH = 20_000;

const agentSpeakers = new Set([
  "agent",
  "business",
  "company",
  "employee",
  "operator",
  "representative",
  "staff",
]);

const callerSpeakers = new Set(["caller", "customer", "lead"]);

const speakerMarker =
  /(?:^|[\r\n]+|[ \t]+)(caller|customer|lead|agent|business|company|employee|operator|representative|staff|speaker)\s*:\s*/giu;

export type CallTranscriptTurn = {
  role: "agent" | "caller" | "unknown";
  speaker: string;
  text: string;
};

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function speakerRole(speaker: string): CallTranscriptTurn["role"] {
  const normalized = speaker.trim().toLowerCase();
  if (agentSpeakers.has(normalized)) return "agent";
  if (callerSpeakers.has(normalized)) return "caller";
  return "unknown";
}

function speakerLabel(speaker: string, role: CallTranscriptTurn["role"]) {
  if (role === "agent") return "Agent";
  if (role === "caller") return "Caller";
  const label = speaker.trim();
  return label
    ? label.charAt(0).toUpperCase() + label.slice(1).toLowerCase()
    : "Transcript";
}

function turn(speaker: string, text: string): CallTranscriptTurn | null {
  const clean = text.trim();
  if (!clean) return null;
  const role = speakerRole(speaker);
  return {
    role,
    speaker: speakerLabel(speaker, role),
    text: clean,
  };
}

/**
 * Turns a stored transcript into message-sized speaker turns. CallRail's
 * structured transcript is serialized one speaker per line, but this also
 * repairs older values where speaker labels were stored inline.
 */
export function parseCallTranscript(value: string | null): CallTranscriptTurn[] {
  const transcript = value?.trim();
  if (!transcript) return [];

  const matches = [...transcript.matchAll(speakerMarker)];
  if (matches.length) {
    const turns: CallTranscriptTurn[] = [];
    const firstIndex = matches[0].index ?? 0;
    const prefix = transcript.slice(0, firstIndex).trim();
    if (prefix) {
      const prefixTurn = turn("Transcript", prefix);
      if (prefixTurn) turns.push(prefixTurn);
    }

    matches.forEach((match, index) => {
      const start = (match.index ?? 0) + match[0].length;
      const end = matches[index + 1]?.index ?? transcript.length;
      const message = turn(match[1] ?? "Transcript", transcript.slice(start, end));
      if (message) turns.push(message);
    });
    return turns;
  }

  return transcript
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^([^:]{1,40}):\s*(.+)$/u);
      return turn(match?.[1] ?? "Transcript", match?.[2] ?? line);
    })
    .filter((item): item is CallTranscriptTurn => item !== null);
}

function serializeTranscript(value: unknown): string | null {
  if (typeof value === "string") {
    return value.trim().slice(0, MAX_TRANSCRIPT_LENGTH) || null;
  }
  if (!Array.isArray(value)) return null;

  const lines = value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return "";
      const row = item as Record<string, unknown>;
      const phrase = cleanText(row.phrase);
      if (!phrase) return "";
      const rawSpeaker = cleanText(row.speaker) || "speaker";
      const role = speakerRole(rawSpeaker);
      const label = role === "unknown" ? rawSpeaker : role;
      return `${label}: ${phrase}`;
    })
    .filter(Boolean);

  return lines.join("\n").slice(0, MAX_TRANSCRIPT_LENGTH) || null;
}

/** Prefer CallRail's speaker-aware array over its plain transcription string. */
export function selectCallRailTranscript(
  conversationalTranscript: unknown,
  transcription: unknown,
): string | null {
  return (
    serializeTranscript(conversationalTranscript) ??
    serializeTranscript(transcription)
  );
}
