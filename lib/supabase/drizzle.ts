import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import * as schema from "../../drizzle/supabase/schema";
import { getSupabaseRuntimeEnv } from "./env";

let sqlClient: Sql | null = null;
let db: PostgresJsDatabase<typeof schema> | null = null;

export function getSupabaseDrizzle() {
  if (db) return db;

  const { databaseUrl } = getSupabaseRuntimeEnv();
  if (!databaseUrl) {
    throw new Error(
      "Supabase Postgres is not configured. Add SUPABASE_DATABASE_URL or DATABASE_URL.",
    );
  }

  sqlClient = postgres(databaseUrl, {
    // Required for Supabase Transaction Pooler compatibility.
    prepare: false,
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  db = drizzle(sqlClient, { schema });
  return db;
}

export async function closeSupabaseDrizzle() {
  await sqlClient?.end({ timeout: 5 });
  sqlClient = null;
  db = null;
}
