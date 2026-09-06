import { placeCallRailOutboundCall } from "./callrail";
import { loadCallRailApiAccess } from "./callrail-store";
import { placeTwilioOutboundCall } from "./twilio";

export type ProviderOutboundCallInput = {
  organizationId: string;
  clientId: string;
  connectionAccountId: string;
  providerAccountId: string;
  providerStatus: string;
  fromNumber: string;
  businessPhoneNumber: string;
  customerPhoneNumber: string;
};

export type ProviderOutboundCall = {
  providerCallId: string;
  status: string;
  startedAt: string;
};

/** Contract every phone provider implements behind the common call service. */
export type CallProviderAdapter = {
  provider: string;
  placeOutbound(input: ProviderOutboundCallInput): Promise<ProviderOutboundCall>;
};

const callRailAdapter: CallProviderAdapter = {
  provider: "callrail",
  async placeOutbound(input) {
    const access = await loadCallRailApiAccess(input.organizationId, input.clientId);
    if (!access.accountId) throw new Error("Finish selecting the CallRail account first.");
    const placed = await placeCallRailOutboundCall({
      accountId: access.accountId,
      apiKey: access.apiKey,
      callerId: input.fromNumber,
      businessPhoneNumber: input.businessPhoneNumber,
      customerPhoneNumber: input.customerPhoneNumber,
    });
    return {
      providerCallId: placed.id,
      status: placed.answered === true ? "completed" : "queued",
      startedAt: placed.startedAt ?? new Date().toISOString(),
    };
  },
};

const twilioAdapter: CallProviderAdapter = {
  provider: "twilio",
  async placeOutbound(input) {
    const accountSid = input.providerAccountId || input.connectionAccountId;
    if (!accountSid) throw new Error("The Twilio account is not configured.");
    if (input.providerStatus !== "connected") {
      throw new Error("The Twilio phone system is not connected.");
    }
    const placed = await placeTwilioOutboundCall({
      accountSid,
      fromNumber: input.fromNumber,
      businessPhoneNumber: input.businessPhoneNumber,
      customerPhoneNumber: input.customerPhoneNumber,
    });
    return {
      providerCallId: placed.sid,
      status: placed.status,
      startedAt: placed.startedAt,
    };
  },
};

const adapters = new Map(
  [callRailAdapter, twilioAdapter].map((adapter) => [adapter.provider, adapter]),
);

export function callProviderAdapter(provider: string) {
  const adapter = adapters.get(provider.toLowerCase());
  if (!adapter) throw new Error(`Callbacks through ${provider} are not supported yet.`);
  return adapter;
}
