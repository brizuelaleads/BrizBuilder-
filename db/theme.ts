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

// Backdrops behind the Glass theme's panels; a per-user preference like the
// theme itself. Classic ignores it.
export type CrmBackdrop = "red" | "chrome" | "halftone" | "eyes" | "silk" | "red-halftone" | "pink-swirl";
// `tint` is the RGB the Glass panels take over this backdrop: the backdrop's
// average hue kept very dark (lightness ~7%), so the blocks match the
// background while white text keeps its contrast.
export const CRM_BACKDROPS = [
  { id: "red", label: "Red grain", description: "Saturated red with soft black forms and film grain.", tint: "27 8 9" },
  { id: "chrome", label: "Black chrome", description: "Dark liquid folds catching a soft highlight.", tint: "16 16 18" },
  { id: "halftone", label: "Halftone", description: "Silky folds rendered as a fine dot screen.", tint: "15 15 16" },
  { id: "eyes", label: "Eyes", description: "Charcoal eyes drawn in stippled black and white.", tint: "18 18 18" },
  { id: "silk", label: "Silver silk", description: "Liquid metal waves with fine scan lines.", tint: "18 18 19" },
  { id: "red-halftone", label: "Red halftone", description: "Red and white drapes in a coarse dot print.", tint: "27 9 9" },
  { id: "pink-swirl", label: "Pink swirl", description: "Marbled pink, red and white with grain.", tint: "27 9 13" },
] as const satisfies readonly { id: CrmBackdrop; label: string; description: string; tint: string }[];
export const DEFAULT_CRM_BACKDROP: CrmBackdrop = "red";
export const isCrmBackdrop = (value: unknown): value is CrmBackdrop =>
  CRM_BACKDROPS.some((backdrop) => backdrop.id === value);

// Optional blur over the backdrop, also per user.
export type CrmBackdropBlur = "none" | "soft" | "strong";
export const CRM_BACKDROP_BLURS = [
  { id: "none", label: "Off" },
  { id: "soft", label: "Soft" },
  { id: "strong", label: "Strong" },
] as const satisfies readonly { id: CrmBackdropBlur; label: string }[];
export const DEFAULT_CRM_BACKDROP_BLUR: CrmBackdropBlur = "none";
export const isCrmBackdropBlur = (value: unknown): value is CrmBackdropBlur =>
  CRM_BACKDROP_BLURS.some((blur) => blur.id === value);
export const backdropTint = (backdrop: CrmBackdrop) =>
  CRM_BACKDROPS.find((option) => option.id === backdrop)?.tint ?? "14 11 12";
