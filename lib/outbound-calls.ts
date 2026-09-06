import { callProviderAdapter } from "./call-provider-adapters";
import { getSupabaseAdminClient } from "./supabase/server";

type Row = Record<string, unknown>;

function database() {
  return getSupabaseAdminClient();
}

function normalizePhone(value: unknown) {
  const digits = String(value ?? "").replace(/\D/gu, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return null;
}

function providerActive(status: unknown) {
  return !new Set(["disconnected", "not_connected", "revoked", "failed"]).has(
    String(status ?? "").toLowerCase(),
  );
}

function asConfig(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function checked<T>(promise: PromiseLike<{ data: T; error: { message: string } | null }>) {
  const result = await promise;
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

export type OutboundCallResult = {
  callId: string;
  provider: string;
  providerCallId: string;
  fromNumber: string;
  customerNumber: string;
  status: string;
};

/**
 * Resolve and place a callback entirely on the server. The input identifies a
 * CRM call; it never supplies a provider, credential, tenant, or caller ID.
 */
export async function placeOutboundCall(input: {
  organizationId: string;
  allowedClientIds: string[] | null;
  callId: string;
}): Promise<OutboundCallResult> {
  const db = database();
  const sourceCall = (await checked(
    db
      .from("phone_calls")
      .select(
        "id,organization_id,client_id,contact_id,lead_id,provider,direction," +
          "customer_phone,business_phone,business_phone_number_id,campaign,started_at",
      )
      .eq("organization_id", input.organizationId)
      .eq("id", input.callId)
      .maybeSingle(),
  )) as Row | null;
  if (!sourceCall) throw new Error("Call not found.");

  const clientId = String(sourceCall.client_id);
  if (input.allowedClientIds && !input.allowedClientIds.includes(clientId)) {
    throw new Error("Forbidden");
  }
  const customerNumber = normalizePhone(sourceCall.customer_phone);
  if (!customerNumber) throw new Error("This call does not have a valid customer number.");

  const [numbersData, recentInbound, lead, contact, client, configs, connections] =
    await Promise.all([
      checked(
        db
          .from("phone_numbers")
          .select("id,connection_id,provider,phone_number,normalized_phone_number,display_name,purpose,provider_config,is_default")
          .eq("organization_id", input.organizationId)
          .eq("client_id", clientId)
          .eq("is_active", true),
      ),
      checked(
        db
          .from("phone_calls")
          .select("business_phone_number_id")
          .eq("organization_id", input.organizationId)
          .eq("client_id", clientId)
          .eq("customer_phone", customerNumber)
          .eq("direction", "inbound")
          .not("business_phone_number_id", "is", null)
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ),
      sourceCall.lead_id
        ? checked(
            db
              .from("leads")
              .select("last_inbound_phone_number_id")
              .eq("organization_id", input.organizationId)
              .eq("client_id", clientId)
              .eq("id", String(sourceCall.lead_id))
              .maybeSingle(),
          )
        : Promise.resolve(null),
      sourceCall.contact_id
        ? checked(
            db
              .from("contacts")
              .select("last_inbound_phone_number_id")
              .eq("organization_id", input.organizationId)
              .eq("client_id", clientId)
              .eq("id", String(sourceCall.contact_id))
              .maybeSingle(),
          )
        : Promise.resolve(null),
      checked(
        db
          .from("clients")
          .select("phone")
          .eq("organization_id", input.organizationId)
          .eq("id", clientId)
          .single(),
      ),
      checked(
        db
          .from("phone_system_configs")
          .select("provider,provider_account_sid,phone_number,forwarding_number,provider_status")
          .eq("organization_id", input.organizationId)
          .eq("client_id", clientId),
      ),
      checked(
        db
          .from("provider_connections")
          .select("id,provider,status,external_account_id")
          .eq("organization_id", input.organizationId)
          .eq("client_id", clientId),
      ),
    ]);

  const numbers = (numbersData ?? []) as Row[];
  const byId = (id: unknown) =>
    id ? numbers.find((number) => String(number.id) === String(id)) : undefined;
  const byPhone = (value: unknown, provider?: unknown) => {
    const normalized = normalizePhone(value);
    return normalized
      ? numbers.find(
          (number) =>
            String(number.normalized_phone_number) === normalized &&
            (!provider || String(number.provider) === String(provider)),
        )
      : undefined;
  };
  const campaign = String(sourceCall.campaign ?? "").trim().toLowerCase();
  const campaignNumber = campaign
    ? numbers.find((number) =>
        `${number.purpose ?? ""} ${number.display_name ?? ""}`
          .toLowerCase()
          .includes(campaign),
      )
    : undefined;

  // Priority: latest inbound route, persisted lead/contact route, campaign,
  // then the tenant's configured default. The source row is an immediate
  // latest-inbound shortcut and is still validated against this tenant registry.
  const route =
    byId(sourceCall.business_phone_number_id) ??
    byPhone(sourceCall.business_phone, sourceCall.provider) ??
    byId((recentInbound as Row | null)?.business_phone_number_id) ??
    byId((lead as Row | null)?.last_inbound_phone_number_id) ??
    byId((contact as Row | null)?.last_inbound_phone_number_id) ??
    campaignNumber ??
    numbers.find((number) => number.is_default === true);
  if (!route) {
    throw new Error("No active outbound phone number is configured for this business.");
  }

  const provider = String(route.provider).toLowerCase();
  const connection = ((connections ?? []) as Row[]).find(
    (item) =>
      (route.connection_id && String(item.id) === String(route.connection_id)) ||
      (!route.connection_id && String(item.provider) === provider),
  );
  if (!connection || String(connection.provider) !== provider || !providerActive(connection.status)) {
    throw new Error(`The ${provider} connection for this number is not active.`);
  }

  const fromNumber = normalizePhone(route.normalized_phone_number ?? route.phone_number);
  if (!fromNumber) throw new Error("The selected business number is invalid.");
  const routeConfig = asConfig(route.provider_config);
  const providerConfig = ((configs ?? []) as Row[]).find(
    (item) => String(item.provider).toLowerCase() === provider,
  );
  const businessPhoneNumber = normalizePhone(
    routeConfig.businessPhoneNumber ??
      routeConfig.forwardingNumber ??
      providerConfig?.forwarding_number ??
      (client as Row).phone,
  );
  if (!businessPhoneNumber) {
    throw new Error("Configure the business forwarding number before placing callbacks.");
  }

  const placed = await callProviderAdapter(provider).placeOutbound({
    organizationId: input.organizationId,
    clientId,
    connectionAccountId: String(connection.external_account_id ?? ""),
    providerAccountId: String(providerConfig?.provider_account_sid ?? ""),
    providerStatus: String(providerConfig?.provider_status ?? ""),
    fromNumber,
    businessPhoneNumber,
    customerPhoneNumber: customerNumber,
  });
  const { providerCallId, status, startedAt } = placed;

  const saved = (await checked(
    db
      .from("phone_calls")
      .upsert(
        {
          organization_id: input.organizationId,
          client_id: clientId,
          contact_id: sourceCall.contact_id,
          lead_id: sourceCall.lead_id,
          provider_call_sid:
            provider === "twilio" ? providerCallId : `${provider}:${providerCallId}`,
          provider,
          provider_connection_id: connection.id,
          provider_call_id: providerCallId,
          business_phone_number_id: route.id,
          direction: "outbound",
          from_number: fromNumber,
          to_number: customerNumber,
          status,
          answered: status === "completed" ? true : null,
          customer_phone: customerNumber,
          business_phone: fromNumber,
          started_at: startedAt,
          raw_event: {},
          updated_at: new Date().toISOString(),
        },
        { onConflict: "organization_id,client_id,provider,provider_call_id" },
      )
      .select("id")
      .single(),
  )) as Row;

  return {
    callId: String(saved.id),
    provider,
    providerCallId,
    fromNumber,
    customerNumber,
    status,
  };
}
