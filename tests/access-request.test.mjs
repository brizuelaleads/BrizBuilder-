import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  receiveAccessRequest,
  validateAccessRequest,
} from "../lib/access-request.ts";

const valid = {
  name: "Ada",
  email: "ADA@example.com",
  business: "Ada Services",
  message: "Please invite my team.",
  consent: true,
  website: "",
};
const request = (body = valid, headers = {}) =>
  new Request("https://brizbuilder.com/api/access-requests", {
    method: "POST",
    headers: {
      origin: "https://brizbuilder.com",
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
const forbidden = async () => {
  assert.fail("No storage or email should be called");
};

test("access request validates contact consent, bounded fields, and email", () => {
  assert.equal(validateAccessRequest(valid).email, "ada@example.com");
  for (const invalid of [
    null,
    [],
    { ...valid, consent: false },
    { ...valid, email: "bad" },
    { ...valid, business: " " },
    { ...valid, name: "x".repeat(101) },
    { ...valid, message: "x".repeat(2001) },
  ]) {
    assert.throws(() => validateAccessRequest(invalid));
  }
});

test("persists before notifying and hashes the network address", async () => {
  const calls = [];
  const response = await receiveAccessRequest(
    request(valid, { "cf-connecting-ip": "192.0.2.4" }),
    {
      async save(input, hash) {
        calls.push("saved");
        assert.equal(input.email, "ada@example.com");
        assert.match(hash, /^[a-f0-9]{64}$/);
        assert.notEqual(hash, "192.0.2.4");
        return { status: "accepted", requestId: "request-1" };
      },
      async notify(input, id) {
        calls.push("notified");
        assert.equal(id, "request-1");
        assert.equal(input.business, "Ada Services");
      },
    },
  );
  assert.equal(response.status, 202);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(calls, ["saved", "notified"]);
});

test("stored request survives an email failure but storage failure is not success", async () => {
  const saved = await receiveAccessRequest(request(), {
    save: async () => ({ status: "accepted", requestId: "one" }),
    notify: async () => {
      throw Error("provider secret should never leak");
    },
  });
  assert.equal(saved.status, 202);
  const failed = await receiveAccessRequest(request(), {
    save: async () => {
      throw Error("database secret");
    },
    notify: forbidden,
  });
  assert.equal(failed.status, 503);
  assert.doesNotMatch(await failed.text(), /database secret/);
});

test("duplicate requests do not send a second notification", async () => {
  const result = await receiveAccessRequest(request(), {
    save: async () => ({ status: "duplicate" }),
    notify: forbidden,
  });
  assert.equal(result.status, 202);
});

test("throttled requests tell the applicant when to retry", async () => {
  const result = await receiveAccessRequest(request(), {
    save: async () => ({ status: "rate_limited" }),
    notify: forbidden,
  });
  assert.equal(result.status, 429);
  assert.equal(result.headers.get("retry-after"), "3600");
});

test("rejects foreign/missing origins and unsupported content before writes", async () => {
  for (const headers of [
    { origin: "https://evil.example" },
    { origin: "" },
    { "content-type": "text/plain" },
  ]) {
    const result = await receiveAccessRequest(request(valid, headers), {
      save: forbidden,
      notify: forbidden,
    });
    assert.ok([403, 415].includes(result.status));
  }
});

test("bounds streamed bodies even without Content-Length", async () => {
  const result = await receiveAccessRequest(
    request({ ...valid, message: "a".repeat(9000) }),
    { save: forbidden, notify: forbidden },
  );
  assert.equal(result.status, 413);
});

test("bot field never saves a request or sends email", async () => {
  const result = await receiveAccessRequest(
    request({ ...valid, website: "bot.example" }),
    { save: forbidden, notify: forbidden },
  );
  assert.equal(result.status, 202);
});

test("private inbox and submission RPC do not grant applicant account access", () => {
  const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  const migration = read(
    "supabase/migrations/20260906150000_access_requests.sql",
  );
  assert.match(migration, /enable row level security/);
  assert.match(
    migration,
    /revoke all on public.access_requests from public, anon, authenticated/,
  );
  assert.match(
    migration,
    /revoke all on function public.submit_access_request.*from public, anon, authenticated/,
  );
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /set search_path = ''/);
  const inbox = read("app/access-requests/page.tsx");
  assert.ok(
    inbox.indexOf("notFound()") < inbox.indexOf('.from("access_requests")'),
  );
  assert.match(inbox, /user.email.toLowerCase\(\) !== MAIN_ADMIN_EMAIL/);
  assert.doesNotMatch(
    read("app/api/access-requests/route.ts"),
    /createUser|inviteUser|membership/,
  );
});
