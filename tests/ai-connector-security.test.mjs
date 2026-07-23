import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const migrationPath = path.join(
  root,
  "supabase/migrations/20260722220000_ai_connector_transactional_mutations.sql",
);
const mcpPath = path.join(root, "lib/ai-connector/mcp.ts");
const performanceMigrationPath = path.join(
  root,
  "supabase/migrations/20260722230000_ai_connector_performance_indexes.sql",
);

test("AI connector mutations are tenant-pinned, atomic, and idempotent", () => {
  const migration = fs.readFileSync(migrationPath, "utf8");

  assert.match(
    migration,
    /create table if not exists public\.ai_mutation_idempotency[\s\S]*unique \(authorization_id, request_id\)/i,
  );
  assert.match(migration, /payload_hash text not null/i);
  assert.match(migration, /payload_hash ~ '\^\[0-9a-f\]\{64\}\$'/i);
  assert.doesNotMatch(
    migration,
    /^\s*(?:title|body|description|payload)\s+(?:text|jsonb?)\b/im,
    "the idempotency table must never store task or note content",
  );
  assert.match(
    migration,
    /alter table public\.ai_mutation_idempotency enable row level security/i,
  );
  assert.match(
    migration,
    /revoke all on table public\.ai_mutation_idempotency[\s\S]*from public, anon, authenticated/i,
  );
  assert.match(
    migration,
    /grant select on table public\.ai_mutation_idempotency to service_role/i,
  );

  const grantFunction = migration.match(
    /create or replace function public\.ai_assert_mutation_grant[\s\S]*?\n\$\$;/i,
  )?.[0];
  assert.ok(grantFunction, "grant assertion function exists");
  assert.match(grantFunction, /security definer[\s\S]*set search_path = pg_catalog/i);
  assert.match(grantFunction, /authz\.organization_id = p_organization_id/i);
  assert.match(grantFunction, /p_client_id = any\(authz\.allowed_client_ids\)/i);
  assert.match(grantFunction, /p_required_scope = any\(authz\.scopes\)/i);
  assert.match(grantFunction, /oauth_client\.revoked_at is null/i);
  assert.match(grantFunction, /access_token\.resource = p_resource/i);
  assert.match(grantFunction, /access_token\.expires_at > statement_timestamp\(\)/i);
  assert.match(grantFunction, /access_token\.revoked_at is null/i);
  assert.match(grantFunction, /for update of authz, oauth_client/i);

  for (const [rpc, tool, targetTable] of [
    ["ai_create_task", "crm_create_task", "tasks"],
    ["ai_add_opportunity_note", "crm_add_opportunity_note", "notes"],
    ["ai_move_opportunity_stage", "crm_move_opportunity_stage", "leads"],
  ]) {
    const body = migration.match(
      new RegExp(
        `create or replace function public\\.${rpc}\\b[\\s\\S]*?\\n\\$\\$;`,
        "i",
      ),
    )?.[0];
    assert.ok(body, `${rpc} exists`);
    assert.match(body, /security definer[\s\S]*set search_path = pg_catalog/i);
    assert.match(body, /pg_advisory_xact_lock/i);
    assert.match(body, /authorization_id = p_authorization_id[\s\S]*request_id = p_request_id/i);
    assert.match(body, new RegExp(`tool_name <> '${tool}'`, "i"));
    assert.match(body, /v_existing\.payload_hash <> v_payload_hash/i);
    assert.match(body, /sha256\([\s\S]*jsonb_build_object/i);
    assert.match(body, new RegExp(`(?:insert into|update) public\\.${targetTable}\\b`, "i"));
    assert.match(body, /insert into public\.audit_events/i);
    assert.match(body, new RegExp(`'ai\\.tool\\.${tool}'`, "i"));
    assert.match(body, /insert into public\.ai_mutation_idempotency/i);
    assert.match(body, /payload_hash,[\s\S]*v_payload_hash/i);
    assert.match(body, /'idempotent_replay', true/i);

    assert.match(
      migration,
      new RegExp(
        `revoke all on function public\\.${rpc}[\\s\\S]*?from public, anon, authenticated;[\\s\\S]*?grant execute on function public\\.${rpc}[\\s\\S]*?to service_role;`,
        "i",
      ),
      `${rpc} is callable only through the trusted service role`,
    );
  }

  assert.doesNotMatch(
    migration,
    /jsonb_build_object\([\s\S]{0,300}'(?:title|body|description)'[\s\S]{0,300}insert into public\.audit_events/i,
    "audit metadata must not contain task or note content",
  );
});

test("MCP write tools require retry keys and use only transactional RPCs", () => {
  const source = fs.readFileSync(mcpPath, "utf8");

  for (const rpc of [
    "ai_create_task",
    "ai_add_opportunity_note",
    "ai_move_opportunity_stage",
  ]) {
    assert.match(source, new RegExp(`executeAiMutationRpc\\("${rpc}"`, "i"));
  }

  assert.doesNotMatch(source, /executeSupabaseCrmAction/);
  assert.match(source, /tokenResource !== AI_CONNECTOR_RESOURCE/);
  assert.match(source, /p_resource: AI_CONNECTOR_RESOURCE/g);
  assert.match(source, /p_access_token_id: grant\.accessTokenId/g);
  assert.match(source, /p_organization_id: grant\.context\.organizationId/g);
  assert.match(source, /p_client_id: clientId/g);
  assert.match(
    source,
    /if \(!MUTATION_TOOL_NAMES\.has\(params\.name\)\)[\s\S]*bestEffortFinalAudit/,
    "successful mutations rely on the RPC's atomic audit instead of adding a second event",
  );

  const requestIdDeclarations = source.match(
    /request_id:\s*\{[\s\S]*?format: "uuid"/g,
  );
  assert.equal(requestIdDeclarations?.length, 3);
  const requiredRequestIds = source.match(
    /required:\s*\["request_id"/g,
  );
  assert.equal(requiredRequestIds?.length, 3);
  const parsedRequestIds = source.match(
    /uuidField\(input, "request_id", "Request ID", true\)/g,
  );
  assert.equal(parsedRequestIds?.length, 3);
});

test("AI connector foreign-key lookups have covering indexes", () => {
  const migration = fs.readFileSync(performanceMigrationPath, "utf8");
  assert.match(
    migration,
    /ai_oauth_consent_requests\(organization_id\)/i,
  );
  assert.match(
    migration,
    /ai_mutation_idempotency\(organization_id, client_id\)/i,
  );
});
