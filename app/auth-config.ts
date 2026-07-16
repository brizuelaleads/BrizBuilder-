export const MAIN_ADMIN_EMAIL =
  process.env.MAIN_ADMIN_EMAIL?.trim().toLowerCase() ?? "admin@brizbuilder.local";
export const MAIN_ADMIN_NAME =
  process.env.MAIN_ADMIN_NAME?.trim() ?? "BrizBuilder Administrator";

// Local preview credentials are compiled out of the production authentication
// path. Hosted BrizBuilder deployments always use ChatGPT sign-in instead.
export const LOCAL_ADMIN_PASSWORD =
  process.env.LOCAL_DEV_ADMIN_PASSWORD ?? "";
export const LOCAL_AUTH_COOKIE = "brizbuilder_local_session";
export const LOCAL_AUTH_TOKEN =
  process.env.LOCAL_DEV_SESSION_TOKEN ?? "";
