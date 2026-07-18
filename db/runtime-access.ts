import type { ChatGPTUser } from "../app/chatgpt-auth";
import {
  getAccountAccess as getD1AccountAccess,
  getClientPortalData as getD1ClientPortalData,
  listAccounts as listD1Accounts,
  upsertClientAccount as upsertD1ClientAccount,
} from "./access";
import type { AccountAccess, ClientPortalData } from "./access";
import { shouldUseSupabaseBackend } from "./backend";
import {
  getSupabaseAccountAccess,
  getSupabaseClientPortalData,
  listSupabaseAccounts,
  upsertSupabaseClientAccount,
} from "./supabase-access";

export type { AccountAccess, ClientPortalData } from "./access";

export async function getAccountAccess(
  user: ChatGPTUser,
): Promise<AccountAccess | null> {
  if (!shouldUseSupabaseBackend()) return getD1AccountAccess(user);
  try {
    return await getSupabaseAccountAccess(user);
  } catch (error) {
    console.error("Supabase access failed; falling back to D1.", error);
    return getD1AccountAccess(user);
  }
}

export async function listAccounts(actor: ChatGPTUser) {
  if (!shouldUseSupabaseBackend()) return listD1Accounts(actor);
  try {
    return await listSupabaseAccounts(actor);
  } catch (error) {
    console.error("Supabase account list failed; falling back to D1.", error);
    return listD1Accounts(actor);
  }
}

export async function getClientPortalData(
  clientId: string,
): Promise<ClientPortalData> {
  if (!shouldUseSupabaseBackend()) return getD1ClientPortalData(clientId);
  try {
    return await getSupabaseClientPortalData(clientId);
  } catch (error) {
    console.error("Supabase client portal failed; falling back to D1.", error);
    return getD1ClientPortalData(clientId);
  }
}

export async function upsertClientAccount(
  actor: ChatGPTUser,
  input: { email: string; displayName: string; clientId: string },
) {
  if (!shouldUseSupabaseBackend()) return upsertD1ClientAccount(actor, input);
  return upsertSupabaseClientAccount(actor, input);
}
