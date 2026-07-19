import postgres from "postgres";

if (!process.env.SUPABASE_DATABASE_URL) throw new Error("SUPABASE_DATABASE_URL is required.");
const db = postgres(process.env.SUPABASE_DATABASE_URL, { prepare: false, ssl: "require" });
try {
  const tables = await db.unsafe("select count(*)::int as count from information_schema.tables where table_schema='public' and table_name in ('phone_system_configs','phone_calls','conversations','messages','automation_rules','automation_runs')");
  const workflowTables = await db.unsafe("select count(*)::int as count from information_schema.tables where table_schema='public' and table_name in ('provider_connections','provider_authorization_states','workflows','workflow_versions','workflow_runs','workflow_run_steps')");
  const workflowRows = await db.unsafe("select (select count(*)::int from workflows) as workflows, (select count(*)::int from provider_connections) as connections");
  const rls = await db.unsafe("select count(*)::int as count from pg_tables where schemaname='public' and tablename in ('provider_connections','provider_authorization_states','workflows','workflow_versions','workflow_runs','workflow_run_steps') and rowsecurity=true");
  const rules = await db.unsafe("select c.business_name, a.enabled from automation_rules a join clients c on c.id=a.client_id where c.business_name='Segovia Pest' and a.trigger_key='call.missed'");
  console.log(JSON.stringify({ phoneTables: tables[0].count, workflowTables: workflowTables[0].count, workflowTablesWithRls: rls[0].count, workflowRows: workflowRows[0].workflows, providerConnections: workflowRows[0].connections, segoviaRule: rules.length === 1, enabled: rules[0]?.enabled ?? null }));
} finally {
  await db.end();
}
