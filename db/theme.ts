// Shared theme constants. Keep this module dependency-free: it is imported by
// both server code (db/crm.ts) and client components, so it must never pull in
// cloudflare:workers or any other server-only module.

export type CrmTheme = "classic" | "cyberpunk" | "midnight" | "glass";
export const CRM_THEMES: readonly CrmTheme[] = ["classic", "cyberpunk", "midnight", "glass"];

// Themes offered in the CRM picker. Cyberpunk and midnight remain valid stored
// values, but predate the current design system and render as classic.
export const CRM_PICKER_THEMES = [
  { id: "classic", label: "Classic" },
  { id: "glass", label: "Glass" },
] as const satisfies readonly { id: CrmTheme; label: string }[];
