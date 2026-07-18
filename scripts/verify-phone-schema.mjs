import postgres from "postgres";

if (!process.env.SUPABASE_DATABASE_URL) throw new Error("SUPABASE_DATABASE_URL is required.");
const db = postgres(process.env.SUPABASE_DATABASE_URL, { prepare: false, ssl: "require" });
try {
  const tables = await db.unsafe("select count(*)::int as count from information_schema.tables where table_schema='public' and table_name in ('phone_system_configs','phone_calls','conversations','messages','automation_rules','automation_runs')");
  const rules = await db.unsafe("select c.business_name, a.enabled from automation_rules a join clients c on c.id=a.client_id where c.business_name='Segovia Pest' and a.trigger_key='call.missed'");
  console.log(JSON.stringify({ phoneTables: tables[0].count, segoviaRule: rules.length === 1, enabled: rules[0]?.enabled ?? null }));
} finally {
  await db.end();
}
