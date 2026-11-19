import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Supply a local PGlite module URL; no production connection or credentials.
const moduleUrl = process.env.PGLITE_MODULE_URL;
test("credential rollout preserves old readers and bridges concurrent legacy writes", {
  skip: !moduleUrl && "Set PGLITE_MODULE_URL to a local @electric-sql/pglite module",
}, async () => {
  const { PGlite } = await import(moduleUrl);
  const db = new PGlite();
  const org = "00000000-0000-4000-8000-000000000001";
  const client = "00000000-0000-4000-8000-000000000002";
  const scope = "https://www.googleapis.com/auth/calendar.events";
  const migration = readFileSync(new URL("../supabase/migrations/20261117000000_separate_google_calendar_credentials.sql", import.meta.url), "utf8");
  const cutover = readFileSync(new URL("../scripts/google-calendar-credential-cutover.sql", import.meta.url), "utf8");
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      grant usage on schema public to anon, authenticated, service_role;
      create table public.organizations (id uuid primary key);
      create table public.clients (id uuid primary key, organization_id uuid not null references public.organizations(id), unique(organization_id,id));
      create table public.google_business_credentials (
        id uuid primary key default gen_random_uuid(), organization_id uuid not null,
        client_id uuid not null, refresh_token_ciphertext text not null,
        refresh_token_iv text not null, scopes text[] not null,
        connected_by_email text not null, created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(), unique(organization_id,client_id));
      insert into public.organizations values ('${org}');
      insert into public.clients values ('${client}','${org}');
      insert into public.google_business_credentials
        (organization_id,client_id,refresh_token_ciphertext,refresh_token_iv,scopes,connected_by_email,updated_at)
        values ('${org}','${client}','fake-old','fake-iv',array['${scope}'],'demo@example.com','2026-11-01');
      grant all on public.google_business_credentials to service_role;
    `);
    await db.exec(migration);
    const token = async (table) => (await db.query(`select refresh_token_ciphertext from public.${table}`)).rows[0]?.refresh_token_ciphertext;
    assert.equal(await token("google_business_credentials"), "fake-old");
    assert.equal(await token("google_calendar_credentials"), "fake-old");
    await db.exec(`set role service_role; update public.google_business_credentials set refresh_token_ciphertext='fake-legacy-refresh',updated_at='2026-11-02'; reset role;`);
    assert.equal(await token("google_calendar_credentials"), "fake-legacy-refresh");
    await db.exec(`update public.google_calendar_credentials set refresh_token_ciphertext='fake-new-flow',updated_at='2026-11-04';`);
    await db.exec(migration);
    await db.exec(`update public.google_business_credentials set refresh_token_ciphertext='fake-stale',updated_at='2026-11-03';`);
    assert.equal(await token("google_calendar_credentials"), "fake-new-flow");
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query("select * from public.google_calendar_credentials"), /permission denied/);
      await db.exec("reset role");
    }
    await assert.rejects(db.exec(`insert into public.google_calendar_credentials
      (organization_id,client_id,refresh_token_ciphertext,refresh_token_iv,connected_by_email)
      values ('00000000-0000-4000-8000-000000000003','${client}','fake','fake','demo@example.com')`), /foreign key/);
    await db.exec(cutover);
    assert.equal(await token("google_business_credentials"), undefined);
    assert.equal(await token("google_calendar_credentials"), "fake-new-flow");
    await db.exec(`insert into public.google_business_credentials
      (organization_id,client_id,refresh_token_ciphertext,refresh_token_iv,scopes,connected_by_email)
      values ('${org}','${client}','fake-mixed','fake',array['${scope}','https://www.googleapis.com/auth/business.manage'],'demo@example.com')`);
    assert.equal(await token("google_calendar_credentials"), "fake-new-flow");
    await db.exec(cutover);
    assert.equal(await token("google_business_credentials"), "fake-mixed");
  } finally { await db.close(); }
});
