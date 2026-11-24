import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSocialContent, socialTransition } from "../lib/social-core.ts";

const sample = {
  title: "  Winter promotion  ",
  caption: "  Post copy ",
  channels: ["instagram", "facebook"],
  plannedDate: "2028-02-29",
  mediaUrl: "https://example.com/creative",
  status: "published",
};

test("draft input preserves calendar days and drops server-owned fields", () => {
  assert.deepEqual(normalizeSocialContent(sample), {
    title: "Winter promotion",
    caption: "Post copy",
    channels: ["instagram", "facebook"],
    plannedDate: "2028-02-29",
    mediaUrl: "https://example.com/creative",
  });
  assert.throws(() => normalizeSocialContent({ ...sample, plannedDate: "2027-02-29" }), /valid planned date/);
  assert.throws(() => normalizeSocialContent({ ...sample, channels: ["facebook", "facebook"] }), /Choose Facebook/);
  assert.throws(() => normalizeSocialContent({ ...sample, mediaUrl: "javascript:alert(1)" }), /HTTPS media link/);
  assert.throws(() => normalizeSocialContent({ ...sample, mediaUrl: "https://user:pass@example.com" }), /HTTPS media link/);
});

test("planning never grants review or publication authority", () => {
  const forbidden = { status: 403 };
  assert.throws(() => socialTransition("approve", false), forbidden);
  assert.throws(() => socialTransition("request_changes", false, "Change the caption."), forbidden);
  assert.throws(() => socialTransition("record_published", false), forbidden);
  assert.throws(() => socialTransition("request_changes", true, " "), /feedback/);
  assert.deepEqual(socialTransition("request_changes", true, " Fix the date. "), {
    from: ["in_review"], status: "changes_requested", feedback: "Fix the date.",
  });
  assert.deepEqual(socialTransition("submit", false).from, ["draft", "changes_requested"]);
  assert.deepEqual(socialTransition("record_published", true).from, ["approved"]);
});
