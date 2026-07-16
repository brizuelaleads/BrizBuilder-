import { env } from "cloudflare:workers";
import type { ChatGPTUser } from "../app/chatgpt-auth";
import { MAIN_ADMIN_EMAIL } from "../app/auth-config";

export { MAIN_ADMIN_EMAIL } from "../app/auth-config";

export type AccessRole = "admin" | "client";

export type ClientIdentity = {
  id: string;
  name: string;
  slug: string;
  industry: string;
  city: string;
  state: string;
  domain: string | null;
};

export type AccountAccess = {
  email: string;
  displayName: string;
  role: AccessRole;
  client: ClientIdentity | null;
};

export type ClientPortalData = {
  leadCount: number;
  recentLeads: Array<{
    id: string;
    contactName: string;
    service: string;
    createdAt: string;
  }>;
};

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    industry TEXT NOT NULL DEFAULT 'Service business',
    city TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL DEFAULT '',
    domain TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY NOT NULL,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'client')),
    client_id TEXT REFERENCES clients(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login_at TEXT
  )`,
  "CREATE INDEX IF NOT EXISTS accounts_client_id_idx ON accounts (client_id)",
  `CREATE TABLE IF NOT EXISTS leads (
    id TEXT PRIMARY KEY NOT NULL,
    client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    contact_name TEXT NOT NULL,
    service TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  "CREATE INDEX IF NOT EXISTS leads_client_id_idx ON leads (client_id)",
  `CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY NOT NULL,
    actor_email TEXT NOT NULL,
    action TEXT NOT NULL,
    target_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  "CREATE INDEX IF NOT EXISTS audit_events_actor_idx ON audit_events (actor_email)",
];

function database(): D1Database {
  if (!env.DB) throw new Error("The access-control database is unavailable.");
  return env.DB;
}

export async function ensureAccessSchema(): Promise<void> {
  const db = database();
  await db.batch(schemaStatements.map((statement) => db.prepare(statement)));

  const seedClients: ClientIdentity[] = [
    { id: "client_summit", name: "Summit Roofing Co.", slug: "summit-roofing", industry: "Roofing", city: "Austin", state: "TX", domain: "summitroofing.com" },
    { id: "client_coolbreeze", name: "CoolBreeze HVAC", slug: "coolbreeze-hvac", industry: "HVAC", city: "Phoenix", state: "AZ", domain: null },
    { id: "client_oakstone", name: "Oak & Stone Plumbing", slug: "oak-stone-plumbing", industry: "Plumbing", city: "Denver", state: "CO", domain: "oakstoneplumbing.com" },
    { id: "client_greenline", name: "Greenline Landscapes", slug: "greenline-landscapes", industry: "Landscaping", city: "Nashville", state: "TN", domain: null },
  ];

  for (const client of seedClients) {
    await db
      .prepare(
        `INSERT INTO clients (id, name, slug, industry, city, state, domain)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           slug = excluded.slug,
           industry = excluded.industry,
           city = excluded.city,
           state = excluded.state,
           domain = excluded.domain`,
      )
      .bind(client.id, client.name, client.slug, client.industry, client.city, client.state, client.domain)
      .run();
  }

  const seedLeads = [
    ["lead_summit_1", "client_summit", "Maria Gonzalez", "Roof replacement", "2026-07-15 18:48:00"],
    ["lead_summit_2", "client_summit", "Noah Lee", "Roof inspection", "2026-07-14 10:30:00"],
    ["lead_coolbreeze_1", "client_coolbreeze", "Ethan Brooks", "AC repair", "2026-07-15 17:10:00"],
    ["lead_oakstone_1", "client_oakstone", "Ava Turner", "Water heater", "2026-07-15 15:45:00"],
    ["lead_greenline_1", "client_greenline", "Sofia Patel", "Landscape design", "2026-07-13 09:15:00"],
  ];
  for (const lead of seedLeads) {
    await db
      .prepare(
        `INSERT INTO leads (id, client_id, contact_name, service, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           client_id = excluded.client_id,
           contact_name = excluded.contact_name,
           service = excluded.service,
           created_at = excluded.created_at`,
      )
      .bind(...lead)
      .run();
  }
}

export async function getAccountAccess(
  user: ChatGPTUser,
): Promise<AccountAccess | null> {
  await ensureAccessSchema();
  const db = database();
  const email = user.email.trim().toLowerCase();

  if (email === MAIN_ADMIN_EMAIL) {
    await db
      .prepare(
        `INSERT INTO accounts (id, email, display_name, role, status, last_login_at)
         VALUES (?, ?, ?, 'admin', 'active', CURRENT_TIMESTAMP)
         ON CONFLICT(email) DO UPDATE SET
           display_name = excluded.display_name,
           role = 'admin',
           client_id = NULL,
           status = 'active',
           last_login_at = CURRENT_TIMESTAMP`,
      )
      .bind("account_main_admin", email, user.displayName)
      .run();
  }

  const row = await db
    .prepare(
      `SELECT
         a.email,
         a.display_name,
         a.role,
         c.id AS client_id,
         c.name AS client_name,
         c.slug AS client_slug,
         c.industry,
         c.city,
         c.state,
         c.domain
       FROM accounts a
       LEFT JOIN clients c ON c.id = a.client_id
       WHERE lower(a.email) = ? AND a.status = 'active'
       LIMIT 1`,
    )
    .bind(email)
    .first<Record<string, string | null>>();

  if (!row) return null;

  const role = row.role === "admin" ? "admin" : "client";
  const client =
    role === "client" && row.client_id && row.client_name && row.client_slug
      ? {
          id: row.client_id,
          name: row.client_name,
          slug: row.client_slug,
          industry: row.industry ?? "Service business",
          city: row.city ?? "",
          state: row.state ?? "",
          domain: row.domain,
        }
      : null;

  if (role === "client" && !client) return null;

  await db
    .prepare("UPDATE accounts SET last_login_at = CURRENT_TIMESTAMP WHERE lower(email) = ?")
    .bind(email)
    .run();

  return {
    email: row.email ?? email,
    displayName: row.display_name ?? user.displayName,
    role,
    client,
  };
}

export async function listAccounts(actor: ChatGPTUser) {
  const access = await getAccountAccess(actor);
  if (access?.role !== "admin") throw new Error("Forbidden");
  return database()
    .prepare(
      `SELECT a.email, a.display_name, a.role, a.status, a.client_id,
              c.name AS client_name, a.last_login_at
       FROM accounts a
       LEFT JOIN clients c ON c.id = a.client_id
       ORDER BY CASE a.role WHEN 'admin' THEN 0 ELSE 1 END, a.display_name`,
    )
    .all();
}

export async function getClientPortalData(
  clientId: string,
): Promise<ClientPortalData> {
  await ensureAccessSchema();
  const db = database();
  const countRow = await db
    .prepare("SELECT COUNT(*) AS total FROM leads WHERE client_id = ?")
    .bind(clientId)
    .first<{ total: number }>();
  const leads = await db
    .prepare(
      `SELECT id, contact_name, service, created_at
       FROM leads
       WHERE client_id = ?
       ORDER BY created_at DESC
       LIMIT 5`,
    )
    .bind(clientId)
    .all<{
      id: string;
      contact_name: string;
      service: string;
      created_at: string;
    }>();

  return {
    leadCount: Number(countRow?.total ?? 0),
    recentLeads: leads.results.map((lead) => ({
      id: lead.id,
      contactName: lead.contact_name,
      service: lead.service,
      createdAt: lead.created_at,
    })),
  };
}

export async function upsertClientAccount(
  actor: ChatGPTUser,
  input: { email: string; displayName: string; clientId: string },
) {
  const access = await getAccountAccess(actor);
  if (access?.role !== "admin") throw new Error("Forbidden");

  const db = database();
  const email = input.email.trim().toLowerCase();
  const displayName = input.displayName.trim();
  const clientId = input.clientId.trim();
  if (!email.includes("@") || !displayName || !clientId) {
    throw new Error("A valid email, name, and client are required.");
  }
  if (email === MAIN_ADMIN_EMAIL) {
    throw new Error("The main administrator cannot be reassigned.");
  }

  const client = await db
    .prepare("SELECT id FROM clients WHERE id = ? LIMIT 1")
    .bind(clientId)
    .first();
  if (!client) throw new Error("Client not found.");

  const accountId = `account_${crypto.randomUUID()}`;
  await db
    .prepare(
      `INSERT INTO accounts (id, email, display_name, role, client_id, status)
       VALUES (?, ?, ?, 'client', ?, 'active')
       ON CONFLICT(email) DO UPDATE SET
         display_name = excluded.display_name,
         role = 'client',
         client_id = excluded.client_id,
         status = 'active'`,
    )
    .bind(accountId, email, displayName, clientId)
    .run();

  await db
    .prepare(
      "INSERT INTO audit_events (id, actor_email, action, target_id) VALUES (?, ?, 'client_access_upserted', ?)",
    )
    .bind(`audit_${crypto.randomUUID()}`, actor.email.toLowerCase(), email)
    .run();

  return { email, displayName, clientId, role: "client" as const };
}
