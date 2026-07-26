// Shared theme constants. Keep this module dependency-free: it is imported by
// both server code (db/crm.ts) and client components, so it must never pull in
// cloudflare:workers or any other server-only module.

export type CrmTheme = "classic" | "cyberpunk" | "midnight";
export const CRM_THEMES: readonly CrmTheme[] = ["classic", "cyberpunk", "midnight"];
