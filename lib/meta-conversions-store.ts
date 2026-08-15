import {
  decryptMetaSecret,
  sendMetaConversionEvent,
  type MetaAttribution,
  type MetaConversionIdentity,
  type MetaRequestContext,
} from "./meta-conversions";
import type { MetaErrorDetail } from "./meta-redaction";
import { getSupabaseAdminClient } from "./supabase/server";

// Loading and using a customer's Meta dataset token. Kept separate from the
// provider client so the token only ever materializes inside a single call.

type MetaCredentialRow = {
  dataset_id: string;
  access_token_ciphertext: string;
  access_token_iv: string;
  test_event_code: string | null;
};

export type MetaConversionOutcome = {
  // False when this client has no Meta connection, which is the normal case
  // rather than a failure.
  attempted: boolean;
  ok: boolean;
  status: "ok" | "rejected" | "unauthorized" | "error" | null;
  // Transient diagnostic for the authenticated admin who triggered the send.
  // Never persisted, never returned on a public route.
  detail: MetaErrorDetail | null;
};

export type MetaConversionDispatch = {
  organizationId: string;
  clientId: string;
  eventName: string;
  eventId: string;
  actionSource: "website" | "system_generated";
  identity: MetaConversionIdentity;
  attribution: MetaAttribution;
  eventSourceUrl?: string | null;
  context?: MetaRequestContext;
  customData?: Record<string, unknown>;
  eventTime?: number;
};

async function loadCredentialRow(
  organizationId: string,
  clientId: string,
): Promise<MetaCredentialRow | null> {
  const result = await getSupabaseAdminClient()
    .from("meta_conversion_credentials")
    .select("dataset_id,access_token_ciphertext,access_token_iv,test_event_code")
    .eq("organization_id", organizationId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return (result.data as MetaCredentialRow | null) ?? null;
}

export async function hasMetaConversionsConnection(
  organizationId: string,
  clientId: string,
): Promise<boolean> {
  return Boolean(await loadCredentialRow(organizationId, clientId));
}

/**
 * Sends one conversion event for a client, if that client has connected Meta.
 *
 * Deliberately never throws. This runs alongside saving a lead or advancing a
 * pipeline stage, and neither of those may fail because an ad platform is down,
 * unreachable, or was disconnected. A client with no Meta connection is the
 * normal case, not an error.
 *
 * The outcome is returned rather than swallowed so an authenticated caller can
 * warn the admin that a conversion did not land. Callers on public routes must
 * ignore it.
 */
export async function dispatchMetaConversion(
  input: MetaConversionDispatch,
): Promise<MetaConversionOutcome> {
  const quiet: MetaConversionOutcome = {
    attempted: false,
    ok: false,
    status: null,
    detail: null,
  };
  try {
    const row = await loadCredentialRow(input.organizationId, input.clientId);
    if (!row) return quiet;

    const accessToken = await decryptMetaSecret(
      {
        ciphertext: row.access_token_ciphertext,
        iv: row.access_token_iv,
      },
      input.organizationId,
      input.clientId,
    );

    const result = await sendMetaConversionEvent({
      datasetId: row.dataset_id,
      accessToken,
      eventName: input.eventName,
      eventId: input.eventId,
      eventTime: input.eventTime,
      actionSource: input.actionSource,
      eventSourceUrl: input.eventSourceUrl,
      identity: input.identity,
      attribution: input.attribution,
      context: input.context,
      customData: input.customData,
      testEventCode: row.test_event_code,
    });

    // Only the closed status vocabulary is persisted — never a provider
    // response body, which can echo back token material.
    await getSupabaseAdminClient()
      .from("meta_conversion_credentials")
      .update({
        last_event_at: new Date().toISOString(),
        last_status: result.status,
        updated_at: new Date().toISOString(),
      })
      .eq("organization_id", input.organizationId)
      .eq("client_id", input.clientId);

    return {
      attempted: true,
      ok: result.ok,
      status: result.status,
      detail: result.detail,
    };
  } catch {
    // Swallowed on purpose: see the contract above. Reported as a transport
    // failure so a caller can still tell the admin the conversion did not land.
    return { attempted: true, ok: false, status: "error", detail: null };
  }
}
