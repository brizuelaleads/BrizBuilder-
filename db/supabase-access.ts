import type { ChatGPTUser } from "../app/chatgpt-auth";
import { MAIN_ADMIN_EMAIL } from "../app/auth-config";
import { getSupabaseAdminClient } from "../lib/supabase/server";
import type { AccountAccess, ClientPortalData } from "./access";

type SupabaseAccountRow = {
  email: string | null;
  display_name: string | null;
  role: string | null;
  status: string | null;
  client_id: string | null;
  client_name: string | null;
  client_slug: string | null;
  industry: string | null;
  city: string | null;
  state: string | null;
  domain: string | null;
  last_login_at: string | null;
};

export async function getSupabaseAccountAccess(
  user: ChatGPTUser,
): Promise<AccountAccess | null> {
  const email = user.email.trim().toLowerCase();

  if (email === MAIN_ADMIN_EMAIL) {
    return {
      email,
      displayName: user.displayName,
      role: "admin",
      client: null,
    };
  }

  const supabase = getSupabaseAdminClient();
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id,email,display_name,status")
    .eq("email", email)
    .eq("status", "active")
    .maybeSingle();

  if (profileError) throw new Error(profileError.message);
  if (!profile?.id) return null;

  const { data: membership, error: membershipError } = await supabase
    .from("client_members")
    .select(
      "client_id, role, status, clients(id,business_name,slug,industry,city,state,website)",
    )
    .eq("profile_id", profile.id)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (membershipError) throw new Error(membershipError.message);
  const rawClient = Array.isArray(membership?.clients)
    ? membership?.clients[0]
    : membership?.clients;
  if (!rawClient?.id) return null;

  return {
    email,
    displayName: String(profile.display_name ?? user.displayName),
    role: "client",
    client: {
      id: String(rawClient.id),
      name: String(rawClient.business_name),
      slug: String(rawClient.slug),
      industry: String(rawClient.industry ?? "Service business"),
      city: String(rawClient.city ?? ""),
      state: String(rawClient.state ?? ""),
      domain: rawClient.website ? String(rawClient.website) : null,
    },
  };
}

export async function listSupabaseAccounts(actor: ChatGPTUser) {
  const access = await getSupabaseAccountAccess(actor);
  if (access?.role !== "admin") throw new Error("Forbidden");

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("client_members")
    .select(
      "role,status,created_at,profiles(email,display_name),clients(id,business_name)",
    )
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  const rows: SupabaseAccountRow[] = [
    {
      email: MAIN_ADMIN_EMAIL,
      display_name: actor.displayName,
      role: "admin",
      status: "active",
      client_id: null,
      client_name: null,
      client_slug: null,
      industry: null,
      city: null,
      state: null,
      domain: null,
      last_login_at: null,
    },
    ...(data ?? []).map((row) => {
      const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
      const client = Array.isArray(row.clients) ? row.clients[0] : row.clients;
      return {
        email: profile?.email ?? null,
        display_name: profile?.display_name ?? null,
        role: "client",
        status: row.status ?? "active",
        client_id: client?.id ?? null,
        client_name: client?.business_name ?? null,
        client_slug: null,
        industry: null,
        city: null,
        state: null,
        domain: null,
        last_login_at: null,
      };
    }),
  ];

  return { results: rows };
}

export async function getSupabaseClientPortalData(
  clientId: string,
): Promise<ClientPortalData> {
  const supabase = getSupabaseAdminClient();
  const [{ count, error: countError }, { data, error }] = await Promise.all([
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId)
      .is("archived_at", null),
    supabase
      .from("leads")
      .select("id,service_requested,created_at,contacts(first_name,last_name)")
      .eq("client_id", clientId)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  if (countError) throw new Error(countError.message);
  if (error) throw new Error(error.message);

  return {
    leadCount: count ?? 0,
    recentLeads: (data ?? []).map((lead) => {
      const contact = Array.isArray(lead.contacts) ? lead.contacts[0] : lead.contacts;
      return {
        id: String(lead.id),
        contactName: `${contact?.first_name ?? ""} ${contact?.last_name ?? ""}`.trim() || "Unknown contact",
        service: String(lead.service_requested),
        createdAt: String(lead.created_at),
      };
    }),
  };
}

export async function upsertSupabaseClientAccount(
  actor: ChatGPTUser,
  _input: { email: string; displayName: string; clientId: string },
) {
  void _input;
  const access = await getSupabaseAccountAccess(actor);
  if (access?.role !== "admin") throw new Error("Forbidden");
  throw new Error(
    "Client login assignment now uses Supabase Auth. Create/invite the client user in Supabase Auth, then assign them to a client workspace.",
  );
}
