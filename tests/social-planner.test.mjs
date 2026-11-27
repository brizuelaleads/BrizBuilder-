import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeSocialContent, socialTransition } from "../lib/social-core.ts";
import { canReplyToMetaMessage, firstNonEmptySocialPage, metaPostContentError } from "../lib/meta-social-core.ts";

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

test("publishing validates channel media and replies enforce the standard Meta window", () => {
  assert.equal(metaPostContentError("facebook", "Launch caption", null), null);
  assert.match(metaPostContentError("instagram", "Launch caption", null), /public JPEG/);
  assert.equal(metaPostContentError("instagram", "Launch caption", "https://example.com/launch.jpg"), null);
  const receivedAt = "2026-11-23T12:00:00Z";
  const then = Date.parse(receivedAt);
  const day = 24 * 60 * 60_000;
  assert.equal(canReplyToMetaMessage(receivedAt, then + day - 1), true);
  assert.equal(canReplyToMetaMessage(receivedAt, then + day), false);
  assert.equal(canReplyToMetaMessage(receivedAt, then - 1), false);
  assert.equal(canReplyToMetaMessage("unknown", then), false);
});

test("the Worker does not forward Meta credentials on redirects", async () => {
  const source = await readFile(new URL("../lib/meta-social.ts", import.meta.url), "utf8");
  assert.match(source, /redirect: "manual"/);
  assert.match(source, /response\.status >= 300 && response\.status < 400/);
});

test("the social inbox skips empty Meta pages while an older page is available", async () => {
  const requested = [];
  const result = await firstNonEmptySocialPage(async (after) => {
    requested.push(after ?? "start");
    if (!after) return { items: [], after: "page-2" };
    if (after === "page-2") return { items: [], after: "page-3" };
    return { items: [{ id: "message-1" }], after: "page-4" };
  });
  assert.deepEqual(requested, ["start", "page-2", "page-3"]);
  assert.deepEqual(result, { items: [{ id: "message-1" }], after: "page-4" });
});

test("Instagram Login uses Meta's documented conversation and comment edges", async () => {
  const source = await readFile(new URL("../lib/meta-social-inbox.ts", import.meta.url), "utf8");
  assert.match(source, /access\.login === "instagram" \? \{\s*platform: "instagram", limit: "25"/);
  assert.match(source, /`\$\{id\}\/comments`/);
  assert.doesNotMatch(source, /isInstagram \? `\$\{access\.id\}\/media` : `\$\{access\.id\}\/published_posts`/);
});

test("the Instagram preview includes live profile, story, reel, and tagged content", async () => {
  const [reader, view] = await Promise.all([
    readFile(new URL("../lib/meta-social-inbox.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/crm/SocialView.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(reader, /profile_picture_url,followers_count,follows_count,media_count/);
  assert.match(reader, /`\$\{account\.id\}\/stories`/);
  assert.match(reader, /`\$\{account\.id\}\/tags`/);
  assert.match(view, /Instagram profile preview/);
  assert.match(view, /"posts" \| "reels" \| "tagged"/);
});
