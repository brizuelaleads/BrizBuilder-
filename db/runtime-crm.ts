import type { ChatGPTUser } from "../app/chatgpt-auth";
import {
  executeCrmAction as executeD1CrmAction,
  getCrmBootstrap as getD1CrmBootstrap,
} from "./crm";
import type { CrmAction, CrmBootstrap } from "./crm";
import { shouldUseSupabaseBackend } from "./backend";
import {
  executeSupabaseCrmAction,
  getSupabaseCrmBootstrap,
} from "./supabase-crm";

export type { CrmAction, CrmBootstrap } from "./crm";

export async function getCrmBootstrap(user: ChatGPTUser): Promise<CrmBootstrap> {
  if (!shouldUseSupabaseBackend()) return getD1CrmBootstrap(user);
  try {
    return await getSupabaseCrmBootstrap(user);
  } catch (error) {
    console.error("Supabase CRM failed; falling back to D1.", error);
    return getD1CrmBootstrap(user);
  }
}

export async function executeCrmAction(user: ChatGPTUser, input: CrmAction) {
  if (!shouldUseSupabaseBackend()) return executeD1CrmAction(user, input);
  return executeSupabaseCrmAction(user, input);
}
