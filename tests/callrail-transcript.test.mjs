import assert from "node:assert/strict";
import test from "node:test";

import {
  parseCallTranscript,
  selectCallRailTranscript,
} from "../lib/callrail-transcript.ts";

test("the structured CallRail conversation wins over the plain transcription", () => {
  const transcript = selectCallRailTranscript(
    [
      { speaker: "agent", phrase: "Hello, how can I help?", start: 0 },
      { speaker: "caller", phrase: "I need a quote.", start: 2.4 },
    ],
    "Hello, how can I help? I need a quote.",
  );

  assert.equal(
    transcript,
    "agent: Hello, how can I help?\ncaller: I need a quote.",
  );
});

test("each structured speaker phrase becomes its own message", () => {
  const transcript = selectCallRailTranscript(
    [
      { speaker: "agent", phrase: "Hello." },
      { speaker: "caller", phrase: "Hello." },
      { speaker: "agent", phrase: "What can I help with?" },
    ],
    null,
  );

  assert.deepEqual(parseCallTranscript(transcript), [
    { role: "agent", speaker: "Agent", text: "Hello." },
    { role: "caller", speaker: "Caller", text: "Hello." },
    { role: "agent", speaker: "Agent", text: "What can I help with?" },
  ]);
});

test("older inline speaker labels are repaired into separate turns", () => {
  assert.deepEqual(
    parseCallTranscript(
      "Agent: Hello, how can I help? Caller: Hello. Agent: What service do you need?",
    ),
    [
      { role: "agent", speaker: "Agent", text: "Hello, how can I help?" },
      { role: "caller", speaker: "Caller", text: "Hello." },
      {
        role: "agent",
        speaker: "Agent",
        text: "What service do you need?",
      },
    ],
  );
});

test("an unlabeled legacy transcript remains readable without inventing speakers", () => {
  assert.deepEqual(parseCallTranscript("A transcript with no speaker metadata."), [
    {
      role: "unknown",
      speaker: "Transcript",
      text: "A transcript with no speaker metadata.",
    },
  ]);
});
