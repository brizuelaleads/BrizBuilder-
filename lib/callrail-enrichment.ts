import { parseCallTranscript, type CallTranscriptTurn } from "./callrail-transcript.ts";

export type EnrichmentSource =
  | "manual"
  | "form"
  | "callrail"
  | "transcript"
  | "ai_summary";

export type ExtractedValue<T> = {
  value: T;
  confidence: number;
  source: "transcript";
  explicitCorrection?: boolean;
};

export type TranscriptAppointmentStatus =
  | "none"
  | "tentative"
  | "confirmed"
  | "cancelled"
  | "rescheduled";

export type TranscriptAppointment = {
  status: TranscriptAppointmentStatus;
  start: string | null;
  end: string | null;
  timeZone: string;
  confidence: number;
  source: "transcript";
  verified: boolean;
};

export type CallRailTranscriptEnrichment = {
  summary: string;
  customerName: ExtractedValue<string> | null;
  email: ExtractedValue<string> | null;
  phone: ExtractedValue<string> | null;
  address: ExtractedValue<string> | null;
  city: ExtractedValue<string> | null;
  state: ExtractedValue<string> | null;
  zip: ExtractedValue<string> | null;
  requestedService: ExtractedValue<string> | null;
  customerNeed: ExtractedValue<string> | null;
  propertyType: ExtractedValue<"Residential" | "Commercial"> | null;
  companyName: ExtractedValue<string> | null;
  preferredContactMethod: ExtractedValue<"Call" | "Text" | "Email"> | null;
  estimatedValueCents: ExtractedValue<number> | null;
  additionalContact: ExtractedValue<string> | null;
  tags: string[];
  appointment: TranscriptAppointment;
};

export type ExistingFieldSource = {
  source?: string;
  confidence?: number;
  verified?: boolean;
};

/**
 * Transcript facts normally fill blanks. A clearly stated correction may
 * repair inherited structured data, but never a value a person verified in
 * BrizBuilder.
 */
export function shouldApplyTranscriptField(
  existing: unknown,
  field: ExtractedValue<unknown> | null,
  metadata: ExistingFieldSource | undefined,
  minimumConfidence: number,
  placeholder = false,
) {
  if (!field || field.confidence < minimumConfidence) return false;
  const blank =
    existing == null || (typeof existing === "string" && !existing.trim());
  if (blank || placeholder) return true;
  return Boolean(
    field.explicitCorrection &&
      !(metadata?.source === "manual" && metadata.verified === true),
  );
}

const STATE_CODES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR",
  california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE",
  florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL",
  indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA",
  maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI",
  minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT",
  nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ",
  "new mexico": "NM", "new york": "NY", "north carolina": "NC",
  "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR",
  pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT",
  vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV",
  wisconsin: "WI", wyoming: "WY",
};

const WEEKDAYS = [
  "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
];

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

function extracted<T>(
  value: T,
  confidence: number,
  explicitCorrection = false,
): ExtractedValue<T> {
  return {
    value,
    confidence,
    source: "transcript",
    ...(explicitCorrection ? { explicitCorrection: true } : {}),
  };
}

function compact(value: string) {
  return value.replace(/\s+/gu, " ").trim();
}

function sentence(value: string) {
  const clean = compact(value).replace(/^[,.;:!?\s]+|[,.;:!?\s]+$/gu, "");
  if (!clean) return "";
  return clean.charAt(0).toUpperCase() + clean.slice(1) + (/[.!?]$/u.test(clean) ? "" : ".");
}

function titleCase(value: string) {
  return compact(value)
    .toLowerCase()
    .replace(/(?:^|[\s'-])\p{L}/gu, (letter) => letter.toUpperCase());
}

function callerEvidence(turns: CallTranscriptTurn[]) {
  const caller = turns.filter((turn) => turn.role === "caller");
  return caller.length ? caller : turns.filter((turn) => turn.role !== "agent");
}

function correctionLanguage(value: string) {
  return /\b(?:old|wrong|incorrect|doesn['’]?t work|no longer|instead|actually|correction|use this|changed)\b/iu.test(value);
}

function extractName(turns: CallTranscriptTurn[]) {
  for (const turn of callerEvidence(turns)) {
    const match = turn.text.match(
      /\b(?:my name is|this is)\s+([\p{L}][\p{L}'-]+(?:\s+[\p{L}][\p{L}'-]+){1,3})(?=\s*(?:[,.!?]|$))/iu,
    );
    if (!match) continue;
    const value = titleCase(match[1]);
    if (/\b(?:calling because|calling about|for my|with the|from the)\b/iu.test(value)) continue;
    return extracted(value, 0.97, correctionLanguage(turn.text));
  }
  return null;
}

function extractEmail(turns: CallTranscriptTurn[]) {
  for (const turn of callerEvidence(turns)) {
    if (
      /\b(?:might|maybe|possibly|not sure|I think)\b/iu.test(turn.text) &&
      !correctionLanguage(turn.text)
    ) continue;
    const normalized = turn.text
      .replace(/\s+at\s+/giu, "@")
      .replace(/\s+dot\s+/giu, ".");
    const match = normalized.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,24}/iu);
    if (!match) continue;
    return extracted(match[0].toLowerCase(), 0.96, correctionLanguage(turn.text));
  }
  return null;
}

function normalizePhone(value: string) {
  const digits = value.replace(/\D/gu, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length >= 8 && digits.length <= 15 && value.trim().startsWith("+")) {
    return `+${digits}`;
  }
  return null;
}

function extractPhone(turns: CallTranscriptTurn[]) {
  for (const turn of callerEvidence(turns)) {
    if (!/\b(?:phone|number|call|text|reach me|contact me)\b/iu.test(turn.text)) continue;
    if (
      /\b(?:might|maybe|possibly|not sure|I think)\b/iu.test(turn.text) &&
      !correctionLanguage(turn.text)
    ) continue;
    const match = turn.text.match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/u);
    const value = match ? normalizePhone(match[0]) : null;
    if (value) return extracted(value, 0.96, correctionLanguage(turn.text));
  }
  return null;
}

function stateCode(value: string | undefined) {
  const clean = compact(value ?? "").toLowerCase().replace(/[.,]$/u, "");
  if (/^[a-z]{2}$/iu.test(clean)) return clean.toUpperCase();
  return STATE_CODES[clean] ?? null;
}

function extractAddress(turns: CallTranscriptTurn[]) {
  const suffix = "(?:Street|St\\.?|Road|Rd\\.?|Avenue|Ave\\.?|Boulevard|Blvd\\.?|Drive|Dr\\.?|Lane|Ln\\.?|Court|Ct\\.?|Highway|Hwy\\.?|Parkway|Pkwy\\.?|Circle|Way|Trail)";
  const pattern = new RegExp(
    `\\b(?:service address is|address is|house is at|property is at|come to|located at)\\s+(\\d{1,6}\\s+[\\p{L}0-9.' -]{1,80}?\\s${suffix})(?:\\s*(?:,|in)\\s*([\\p{L}.' -]{2,60}?))?(?:,\\s*([\\p{L} ]{2,20}|[A-Z]{2}))?(?:\\s+(\\d{5}(?:-\\d{4})?))?(?:\\s+instead)?(?=[.!?]|$)`,
    "iu",
  );
  for (const turn of callerEvidence(turns)) {
    const match = turn.text.match(pattern);
    if (!match) continue;
    const address = compact(match[1]);
    const possibleState = stateCode(match[3]) ?? stateCode(match[2]);
    const city = match[3] && possibleState ? compact(match[2]) : null;
    const correction = correctionLanguage(turn.text);
    return {
      address: extracted(address, 0.97, correction),
      city: city ? extracted(titleCase(city), 0.94, correction) : null,
      state: possibleState ? extracted(possibleState, 0.97, correction) : null,
      zip: match[4] ? extracted(match[4], 0.99, correction) : null,
    };
  }
  return { address: null, city: null, state: null, zip: null };
}

const SERVICE_RULES: Array<{ pattern: RegExp; label: string; tag: string }> = [
  { pattern: /\bwater heater\b[\s\S]{0,35}\b(?:replace(?:d|ment)?|replacing|new)\b|\b(?:replace(?:d|ment)?|replacing)\b[\s\S]{0,35}\bwater heater\b/iu, label: "Water Heater Replacement", tag: "water-heater" },
  { pattern: /\b(?:a\/?c|air conditioner|air conditioning)\b[\s\S]{0,50}\b(?:not|isn['’]?t|stopped)\s+(?:cooling|working)|\bno (?:cool|cooling)\b/iu, label: "AC Repair", tag: "ac-repair" },
  { pattern: /\btermites?\b/iu, label: "Termite Treatment", tag: "termite-treatment" },
  { pattern: /\bants?\b|\bpest control\b/iu, label: "Pest Control", tag: "pest-control" },
  { pattern: /\b(?:leak|leaking|burst pipe|clogged drain)\b/iu, label: "Plumbing Repair", tag: "plumbing" },
  { pattern: /\b(?:roof leak|roof repair|replace (?:the )?roof)\b/iu, label: "Roof Repair", tag: "roofing" },
];

function extractService(turns: CallTranscriptTurn[]) {
  for (const turn of callerEvidence(turns)) {
    for (const rule of SERVICE_RULES) {
      if (rule.pattern.test(turn.text)) {
        const supportingSentence =
          turn.text
            .split(/(?<=[.!?])\s+/u)
            .find((part) => rule.pattern.test(part)) ?? turn.text;
        return {
          service: extracted(rule.label, 0.96),
          need: extracted(sentence(supportingSentence).slice(0, 360), 0.9),
          tag: rule.tag,
        };
      }
    }
    const generic = turn.text.match(
      /\b(?:i need|i['’]?m calling (?:because|about)|we need|can you (?:help|come))\s+(.{5,180}?)(?=[.!?]|$)/iu,
    );
    if (generic && !/\b(?:maybe|might|not sure)\b/iu.test(generic[1])) {
      const need = sentence(generic[1]).slice(0, 360);
      return {
        service: extracted(need.replace(/[.]$/u, "").slice(0, 160), 0.89),
        need: extracted(sentence(turn.text).slice(0, 360), 0.88),
        tag: null,
      };
    }
  }
  return { service: null, need: null, tag: null };
}

function extractEstimatedValue(turns: CallTranscriptTurn[]) {
  for (const turn of callerEvidence(turns)) {
    if (/\b(?:might|maybe|probably|roughly|around|about|a few|ballpark)\b/iu.test(turn.text)) continue;
    if (!/\b(?:estimate|quote|budget|price|cost|total|value)\b/iu.test(turn.text)) continue;
    const match = turn.text.match(/\$\s*([0-9]{1,7}(?:,[0-9]{3})*(?:\.\d{1,2})?)/u);
    if (!match) continue;
    const dollars = Number(match[1].replaceAll(",", ""));
    if (Number.isFinite(dollars) && dollars > 0 && dollars <= 10_000_000) {
      return extracted(Math.round(dollars * 100), 0.98, correctionLanguage(turn.text));
    }
  }
  return null;
}

function extractContext(turns: CallTranscriptTurn[]) {
  let propertyType: CallRailTranscriptEnrichment["propertyType"] = null;
  let companyName: CallRailTranscriptEnrichment["companyName"] = null;
  let preferredContactMethod: CallRailTranscriptEnrichment["preferredContactMethod"] = null;
  let additionalContact: CallRailTranscriptEnrichment["additionalContact"] = null;
  for (const turn of callerEvidence(turns)) {
    if (!propertyType && /\b(?:my house|my home|residential|homeowner)\b/iu.test(turn.text)) {
      propertyType = extracted("Residential", 0.94);
    }
    if (!propertyType && /\b(?:for my|at my)\s+(?:restaurant|office|store|warehouse)|\bcommercial property\b/iu.test(turn.text)) {
      propertyType = extracted("Commercial", 0.94);
    }
    const company = turn.text.match(/\b(?:company|business) (?:is|name is)\s+([\p{L}0-9&.' -]{2,80})(?=[.!?]|$)/iu);
    if (!companyName && company) companyName = extracted(compact(company[1]), 0.96);
    if (!preferredContactMethod && /\b(?:please|prefer|best to)\s+(?:text|texting)\b|\btext me\b/iu.test(turn.text)) {
      preferredContactMethod = extracted("Text", 0.96);
    } else if (!preferredContactMethod && /\b(?:please|prefer|best to)\s+(?:email|emailing)\b|\bemail me\b/iu.test(turn.text)) {
      preferredContactMethod = extracted("Email", 0.96);
    } else if (!preferredContactMethod && /\b(?:please|prefer|best to)\s+(?:call|calling)\b|\bcall me\b/iu.test(turn.text)) {
      preferredContactMethod = extracted("Call", 0.94);
    }
    const contact = turn.text.match(/\b(?:call|contact|reach) my (wife|husband|spouse|partner|manager)\s+([\p{L}'-]+)(?:\s+if\b|[,.!?]|$)/iu);
    if (!additionalContact && contact) {
      additionalContact = extracted(`${titleCase(contact[1])}: ${titleCase(contact[2])}`, 0.96);
    }
  }
  return { propertyType, companyName, preferredContactMethod, additionalContact };
}

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };

function partsInTimeZone(instant: Date, timeZone: string): LocalParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", hourCycle: "h23", weekday: "long",
  });
  const values = Object.fromEntries(
    formatter.formatToParts(instant).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(values.year), month: Number(values.month), day: Number(values.day),
    hour: Number(values.hour), minute: Number(values.minute),
    weekday: WEEKDAYS.indexOf(String(values.weekday).toLowerCase()),
  };
}

function addLocalDays(parts: LocalParts, days: number) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function zonedLocalToIso(
  local: { year: number; month: number; day: number; hour: number; minute: number },
  timeZone: string,
) {
  let guess = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const actual = partsInTimeZone(new Date(guess), timeZone);
    const wanted = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
    const observed = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute);
    const difference = wanted - observed;
    if (!difference) break;
    guess += difference;
  }
  const verified = partsInTimeZone(new Date(guess), timeZone);
  if (
    verified.year !== local.year || verified.month !== local.month || verified.day !== local.day ||
    verified.hour !== local.hour || verified.minute !== local.minute
  ) return null;
  return new Date(guess).toISOString();
}

type DateCandidate = {
  start: string | null;
  end: string | null;
  label: string;
  explicitTime: boolean;
};

function dateCandidate(text: string, callStartedAt: string, timeZone: string): DateCandidate | null {
  const callDate = new Date(callStartedAt);
  if (Number.isNaN(callDate.getTime())) return null;
  const base = partsInTimeZone(callDate, timeZone);
  const lower = text.toLowerCase();
  let date: { year: number; month: number; day: number } | null = null;
  let label = "";
  if (/\btomorrow\b/iu.test(text)) {
    date = addLocalDays(base, 1);
    label = "tomorrow";
  } else {
    const weekdayMatch = lower.match(/\b(this|next)?\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/u);
    if (weekdayMatch) {
      const target = WEEKDAYS.indexOf(weekdayMatch[2]);
      let days = (target - base.weekday + 7) % 7;
      if (weekdayMatch[1] === "next" && days === 0) days = 7;
      date = addLocalDays(base, days);
      label = weekdayMatch[2];
    }
  }
  if (!date) {
    const dayMatch = lower.match(/\b(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b/u);
    if (dayMatch) {
      let year = base.year;
      let month = base.month;
      const day = Number(dayMatch[1]);
      if (day < base.day) {
        month += 1;
        if (month === 13) { month = 1; year += 1; }
      }
      const valid = new Date(Date.UTC(year, month - 1, day));
      if (valid.getUTCMonth() === month - 1) date = { year, month, day };
      label = dayMatch[0];
    }
  }
  if (!date) {
    const absolute = lower.match(new RegExp(`\\b(${Object.keys(MONTHS).join("|")})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, "u"));
    if (absolute) {
      const year = absolute[3] ? Number(absolute[3]) : base.year;
      date = { year, month: MONTHS[absolute[1]], day: Number(absolute[2]) };
      label = absolute[0];
    }
  }
  if (!date && /\bthis afternoon\b/iu.test(text)) {
    date = { year: base.year, month: base.month, day: base.day };
    label = "this afternoon";
  }
  if (!date) return null;

  const time = text.match(/\b(?:at|around)\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\b/iu);
  const afternoon = /\bafternoon\b/iu.test(text);
  const morning = /\bmorning\b/iu.test(text);
  if (!time) return { start: null, end: null, label, explicitTime: false };
  let hour = Number(time[1]);
  const minute = Number(time[2] ?? 0);
  const meridiem = time[3]?.toLowerCase().replaceAll(".", "") ?? "";
  const explicitTime = Boolean(meridiem || afternoon || morning);
  if (hour < 1 || hour > 12 || minute > 59) return null;
  if (meridiem === "pm" && hour !== 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (!meridiem && afternoon && hour !== 12) hour += 12;
  if (!meridiem && !afternoon && !morning) return { start: null, end: null, label, explicitTime: false };
  const start = zonedLocalToIso({ ...date, hour, minute }, timeZone);
  if (!start) return null;
  return {
    start,
    end: new Date(Date.parse(start) + 60 * 60 * 1000).toISOString(),
    label,
    explicitTime,
  };
}

export function extractTranscriptAppointment(
  transcript: string,
  callStartedAt: string,
  timeZone: string,
): TranscriptAppointment {
  const turns = parseCallTranscript(transcript);
  const empty: TranscriptAppointment = {
    status: "none", start: null, end: null, timeZone,
    confidence: 0, source: "transcript", verified: false,
  };
  let current: DateCandidate | null = null;
  let status: TranscriptAppointmentStatus = "none";
  let confidence = 0;
  let hadConfirmed = false;
  let priorCallerAffirmed = false;

  for (const turn of turns) {
    const candidate = dateCandidate(turn.text, callStartedAt, timeZone);
    const cancelled = /\b(?:cancel(?:led)?|never mind|can['’]?t|cannot|no longer|doesn['’]?t work|won['’]?t work|not available)\b/iu.test(turn.text);
    const tentative = /\b(?:might|maybe|tentative|possibly|how about|would .* work|could .* work)\b/iu.test(turn.text);
    const affirmative = /\b(?:yes|works?|confirmed|book(?:ed)?|schedule(?:d)?|perfect|we['’]?ll see you|see you)\b/iu.test(turn.text);
    const reschedule = /\b(?:reschedul|move (?:it|the appointment)|instead|actually.*(?:day|at))\b/iu.test(turn.text);

    if (
      cancelled &&
      (current || status !== "none" || /\b(?:appointment|visit|booking)\b/iu.test(turn.text))
    ) {
      if (candidate) current = candidate;
      status = "cancelled";
      confidence = 0.98;
      priorCallerAffirmed = false;
      continue;
    }

    if (candidate) {
      // A confirmation commonly repeats "Thursday at 2" after the agent has
      // already established "2 PM". Keep that established time only when the
      // repeated day label is the same.
      if (!candidate.start && current?.start && candidate.label === current.label) {
        candidate.start = current.start;
        candidate.end = current.end;
        candidate.explicitTime = current.explicitTime;
      }
      const changed = Boolean(current?.start && candidate.start && current.start !== candidate.start);
      const sameConfirmedTime = Boolean(
        hadConfirmed &&
        !changed &&
        candidate.start &&
        turn.role === "agent" &&
        affirmative &&
        !tentative,
      );
      current = candidate;
      if (turn.role === "caller" && affirmative && !tentative && candidate.explicitTime) {
        status = hadConfirmed && (changed || reschedule) ? "rescheduled" : "confirmed";
        confidence = 0.96;
        hadConfirmed = true;
        priorCallerAffirmed = true;
      } else if (sameConfirmedTime) {
        status = "confirmed";
        confidence = 0.98;
      } else {
        status = "tentative";
        confidence = candidate.explicitTime ? 0.82 : 0.65;
        priorCallerAffirmed = false;
      }
      continue;
    }

    if (current && affirmative && !tentative) {
      if (turn.role === "caller" || (turn.role === "agent" && priorCallerAffirmed)) {
        if (current.explicitTime && current.start) {
          status = hadConfirmed && reschedule ? "rescheduled" : "confirmed";
          confidence = turn.role === "caller" ? 0.97 : 0.98;
          hadConfirmed = true;
        }
        if (turn.role === "caller") priorCallerAffirmed = true;
      }
    } else if (turn.role === "caller") {
      priorCallerAffirmed = false;
    }
  }

  if (!current && status === "none") return empty;
  const verified = (status === "confirmed" || status === "rescheduled") && Boolean(current?.start);
  return {
    status,
    start: verified ? current?.start ?? null : null,
    end: verified ? current?.end ?? null : null,
    timeZone,
    confidence,
    source: "transcript",
    verified,
  };
}

export function isSystemCallMetadataMessage(value: unknown) {
  if (typeof value !== "string") return false;
  const clean = value.trim();
  if (!clean) return false;
  return (
    /Transcript is available on the CallRail call record\./iu.test(clean) ||
    (/^Call started:/iu.test(clean) && /\bDuration:\s*\d+s\b/iu.test(clean))
  );
}

function providerSummary(value: string | null | undefined) {
  const clean = compact(value ?? "");
  if (!clean || isSystemCallMetadataMessage(clean)) return null;
  return sentence(clean).slice(0, 600);
}

function buildSummary(
  service: ExtractedValue<string> | null,
  need: ExtractedValue<string> | null,
  appointment: TranscriptAppointment,
) {
  let base = service
    ? `Customer called about ${service.value.toLowerCase()}.`
    : need
      ? `Customer called because ${need.value.replace(/[.]$/u, "").toLowerCase()}.`
      : "Customer called to discuss a service need.";
  if (service && need) base = `${base} ${need.value}`;
  const appointmentTime = appointment.start
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: appointment.timeZone,
        weekday: "long",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(appointment.start))
    : null;
  if (appointment.status === "confirmed" || appointment.status === "rescheduled") {
    return `${base} Appointment ${appointment.status === "rescheduled" ? "rescheduled and confirmed" : "confirmed"}${appointmentTime ? ` for ${appointmentTime}` : ""}.`;
  }
  if (appointment.status === "cancelled") return `${base} No appointment remains scheduled.`;
  return base;
}

export function enrichCallRailTranscript(input: {
  transcript: string;
  callStartedAt: string;
  timeZone: string;
  providerSummary?: string | null;
}): CallRailTranscriptEnrichment {
  const turns = parseCallTranscript(input.transcript);
  const address = extractAddress(turns);
  const service = extractService(turns);
  const context = extractContext(turns);
  const appointment = extractTranscriptAppointment(
    input.transcript,
    input.callStartedAt,
    input.timeZone,
  );
  const tags = [
    service.tag,
    context.propertyType?.value === "Commercial" ? "commercial" : null,
    appointment.verified ? "appointment-confirmed" : null,
  ].filter((value): value is string => Boolean(value));
  const provider = providerSummary(input.providerSummary);
  const generatedSummary = buildSummary(service.service, service.need, appointment);
  const summary =
    provider &&
    appointment.verified &&
    !/\b(?:appointment|booked|scheduled|rescheduled)\b/iu.test(provider)
      ? `${provider} ${generatedSummary.slice(generatedSummary.indexOf("Appointment"))}`
      : provider ?? generatedSummary;
  return {
    summary,
    customerName: extractName(turns),
    email: extractEmail(turns),
    phone: extractPhone(turns),
    address: address.address,
    city: address.city,
    state: address.state,
    zip: address.zip,
    requestedService: service.service,
    customerNeed: service.need,
    propertyType: context.propertyType,
    companyName: context.companyName,
    preferredContactMethod: context.preferredContactMethod,
    estimatedValueCents: extractEstimatedValue(turns),
    additionalContact: context.additionalContact,
    tags: [...new Set(tags)],
    appointment,
  };
}
