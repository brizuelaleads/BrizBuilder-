import { getBackendProvider } from "../../../../db/backend";
import { normalizeAttribution } from "../../../../lib/meta-conversions";
import { decideMetaEligibility } from "../../../../lib/meta-eligibility";
import { dispatchMetaConversion } from "../../../../lib/meta-conversions-store";
import { getSupabaseAdminClient } from "../../../../lib/supabase/server";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ key: string }> };
type WebsiteRecord = {
  id: string;
  organization_id: string;
  client_id: string;
  name: string;
  domain: string | null;
  status: string;
  analytics: Record<string, unknown>;
};

function cleanText(value: unknown, max: number) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function normalizeHost(value: string) {
  return value.toLowerCase().replace(/^www\./, "");
}

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  };
}

function siteAllowsOrigin(site: WebsiteRecord, origin: string | null) {
  if (!origin || !site.domain) return true;
  try {
    return normalizeHost(new URL(origin).hostname) === normalizeHost(String(site.domain));
  } catch {
    return false;
  }
}

async function getConnectedSite(key: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(key)) return null;
  if (getBackendProvider() !== "supabase") throw new Error("Website lead capture requires the Supabase backend.");
  const { data, error } = await getSupabaseAdminClient().from("websites").select("id,organization_id,client_id,name,domain,status,analytics").eq("id", key).maybeSingle();
  if (error) throw new Error(error.message);
  const analytics = data?.analytics && typeof data.analytics === "object" ? data.analytics as Record<string, unknown> : {};
  if (!data || data.status !== "connected" || analytics.leadCaptureEnabled === false) return null;
  return { ...data, analytics } as WebsiteRecord;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { key } = await context.params;
    const site = await getConnectedSite(key);
    const origin = request.headers.get("origin");
    if (!site) return Response.json({ connected: false }, { status: 404, headers: corsHeaders(origin) });
    if (!siteAllowsOrigin(site, origin)) return Response.json({ connected: false, error: "This domain is not authorized." }, { status: 403, headers: corsHeaders(origin) });
    return Response.json({ connected: true }, { headers: corsHeaders(origin) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Connection check failed.";
    return Response.json({ connected: false, error: message }, { status: 503, headers: corsHeaders(request.headers.get("origin")) });
  }
}

export async function OPTIONS(request: Request, context: RouteContext) {
  const origin = request.headers.get("origin");
  try {
    const { key } = await context.params;
    const site = await getConnectedSite(key);
    if (!site || !siteAllowsOrigin(site, origin)) return new Response(null, { status: 403, headers: corsHeaders(origin) });
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  } catch {
    return new Response(null, { status: 503, headers: corsHeaders(origin) });
  }
}

export async function POST(request: Request, context: RouteContext) {
  const origin = request.headers.get("origin");
  const headers = corsHeaders(origin);
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 64_000) return Response.json({ error: "Submission is too large." }, { status: 413, headers });
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return Response.json({ error: "Content-Type must be application/json." }, { status: 415, headers });

  try {
    const { key } = await context.params;
    const site = await getConnectedSite(key);
    if (!site) return Response.json({ error: "Website connection is inactive or not found." }, { status: 404, headers });
    if (!siteAllowsOrigin(site, origin)) return Response.json({ error: "This domain is not authorized." }, { status: 403, headers });

    const input = await request.json() as Record<string, unknown>;
    if (cleanText(input.website, 200) || cleanText(input._gotcha, 200)) return Response.json({ accepted: true }, { status: 202, headers });

    const fullName = cleanText(input.name, 160)?.split(/\s+/) ?? [];
    const firstName = cleanText(input.firstName, 80) ?? fullName.shift() ?? null;
    const lastName = cleanText(input.lastName, 80) ?? fullName.join(" ").slice(0, 80);
    const phone = cleanText(input.phone, 40);
    const email = cleanText(input.email, 160)?.toLowerCase() ?? null;
    if (!firstName) return Response.json({ error: "First name is required." }, { status: 400, headers });
    if (!phone && !email) return Response.json({ error: "Phone or email is required." }, { status: 400, headers });

    const supabase = getSupabaseAdminClient();
    const submittedAt = new Date().toISOString();
    let contact: Record<string, unknown> | null = null;
    if (email) {
      const result = await supabase.from("contacts").select("id,first_name,last_name,phone,email,address,city,state,zip,field_provenance,last_interaction_at").eq("organization_id", site.organization_id).eq("client_id", site.client_id).eq("email", email).is("archived_at", null).limit(1).maybeSingle();
      if (result.error) throw new Error(result.error.message);
      contact = result.data;
    }
    if (!contact && phone) {
      const result = await supabase.from("contacts").select("id,first_name,last_name,phone,email,address,city,state,zip,field_provenance,last_interaction_at").eq("organization_id", site.organization_id).eq("client_id", site.client_id).eq("phone", phone).is("archived_at", null).limit(1).maybeSingle();
      if (result.error) throw new Error(result.error.message);
      contact = result.data;
    }
    if (!contact) {
      const result = await supabase.from("contacts").insert({
        organization_id: site.organization_id,
        client_id: site.client_id,
        first_name: firstName,
        last_name: lastName ?? "",
        phone,
        email,
        address: cleanText(input.address, 200),
        city: cleanText(input.city, 80),
        state: cleanText(input.state, 30),
        zip: cleanText(input.zip, 20),
        tags: ["website-lead"],
        marketing_consent: input.consent === true || input.consent === "granted" ? "granted" : "unknown",
        last_interaction_at: submittedAt,
        field_provenance: Object.fromEntries(
          [
            ["first_name", firstName], ["last_name", lastName], ["phone", phone],
            ["email", email], ["address", cleanText(input.address, 200)],
            ["city", cleanText(input.city, 80)], ["state", cleanText(input.state, 30)],
            ["zip", cleanText(input.zip, 20)],
          ].filter(([, value]) => Boolean(value)).map(([field]) => [field, {
            source: "form", confidence: 1, verified: true, updatedAt: submittedAt,
          }]),
        ),
      }).select("id").single();
      if (result.error) throw new Error(result.error.message);
      contact = result.data;
    } else {
      const formValues: Record<string, string | null> = {
        first_name: firstName,
        last_name: lastName || null,
        phone,
        email,
        address: cleanText(input.address, 200),
        city: cleanText(input.city, 80),
        state: cleanText(input.state, 30),
        zip: cleanText(input.zip, 20),
      };
      const fields =
        contact.field_provenance && typeof contact.field_provenance === "object"
          ? { ...(contact.field_provenance as Record<string, unknown>) }
          : {};
      const patch: Record<string, unknown> = {
        last_interaction_at: submittedAt,
        updated_at: submittedAt,
      };
      for (const [field, value] of Object.entries(formValues)) {
        const metadata = fields[field] as { source?: string; verified?: boolean } | undefined;
        const current = String(contact[field] ?? "").trim();
        const placeholder =
          (field === "first_name" && /^(?:phone|unknown|caller)$/iu.test(current)) ||
          (field === "last_name" && /^(?:caller|contact|unknown)$/iu.test(current));
        const lowerPriority = ["callrail", "transcript", "ai_summary"].includes(
          String(metadata?.source ?? ""),
        );
        if (value && (!current || placeholder || lowerPriority)) {
          patch[field] = value;
          fields[field] = {
            source: "form", confidence: 1, verified: true, updatedAt: submittedAt,
          };
        }
      }
      patch.field_provenance = fields;
      const update = await supabase.from("contacts").update(patch).eq("id", String(contact.id));
      if (update.error) throw new Error(update.error.message);
    }

    const [pipelineResult, stageResult] = await Promise.all([
      supabase.from("pipelines").select("id").eq("organization_id", site.organization_id).eq("is_default", true).limit(1).maybeSingle(),
      supabase.from("pipeline_stages").select("id").eq("organization_id", site.organization_id).eq("slug", "new").limit(1).maybeSingle(),
    ]);
    if (pipelineResult.error) throw new Error(pipelineResult.error.message);
    if (stageResult.error) throw new Error(stageResult.error.message);
    if (!pipelineResult.data?.id || !stageResult.data?.id) throw new Error("The CRM lead pipeline is not configured.");

    const service = cleanText(input.service, 160) ?? cleanText(input.serviceRequested, 160) ?? "Website inquiry";
    const now = submittedAt;
    // Ad click identifiers forwarded by the landing page. Unknown keys are
    // dropped, so a page can post its whole query string without risk.
    const attribution = normalizeAttribution(input);
    // Decided here, from the submission itself, and stored on the lead. Only a
    // validated Meta click id qualifies; a utm_source or a source label is
    // caller-controlled on this public endpoint and proves nothing. The
    // database rejects any later attempt to revise this.
    const eligibility = decideMetaEligibility(input);
    const leadResult = await supabase.from("leads").insert({
      organization_id: site.organization_id,
      client_id: site.client_id,
      contact_id: contact.id,
      pipeline_id: pipelineResult.data.id,
      stage_id: stageResult.data.id,
      service_requested: service,
      message: cleanText(input.message, 1200) ?? "",
      source: `Website · ${String(site.name).slice(0, 80)}`,
      campaign: cleanText(input.campaign, 160),
      status: "NEW",
      lead_score: 60,
      tags: ["website-lead"],
      consent_status: input.consent === true || input.consent === "granted" ? "granted" : "unknown",
      attribution,
      meta_eligible: eligibility.eligible,
      meta_eligibility_reason: eligibility.reason,
      first_contacted_at: now,
      last_contacted_at: now,
      field_provenance: {
        service_requested: { source: "form", confidence: 1, verified: true, updatedAt: now },
        ...(cleanText(input.message, 1200)
          ? { message: { source: "form", confidence: 1, verified: true, updatedAt: now } }
          : {}),
        source: { source: "form", confidence: 1, verified: true, updatedAt: now },
        ...(cleanText(input.campaign, 160)
          ? { campaign: { source: "form", confidence: 1, verified: true, updatedAt: now } }
          : {}),
      },
    }).select("id").single();
    if (leadResult.error) throw new Error(leadResult.error.message);

    const safePayload = { firstName, lastName, phone, email, service, message: cleanText(input.message, 1200), campaign: cleanText(input.campaign, 160) };
    await Promise.all([
      supabase.from("form_submissions").insert({ organization_id: site.organization_id, client_id: site.client_id, form_id: null, payload: safePayload, lead_id: leadResult.data.id }),
      supabase.from("websites").update({ analytics: { ...site.analytics, lastLeadAt: now }, updated_at: now }).eq("id", site.id),
      supabase.from("audit_events").insert({ organization_id: site.organization_id, client_id: site.client_id, actor_email: `website:${site.domain ?? site.id}`, action: "website.lead_captured", record_type: "lead", record_id: leadResult.data.id, metadata: { websiteId: site.id, source: "website" } }),
    ]);

    // Tell Meta the ad click converted so its targeting can learn from it.
    // This never throws and never fails the capture — a lead is worth more than
    // an ad signal, so an outage at Meta must not cost the customer the lead.
    // Visitor IP and user agent improve match quality but are passed through
    // here only; they are never written to the database.
    // Google, organic, direct, referral and unattributed leads save exactly as
    // before but are never reported: Meta must only learn from clicks it
    // actually produced.
    if (eligibility.eligible) {
      await dispatchMetaConversion({
        organizationId: site.organization_id,
        clientId: site.client_id,
        eventName: "Lead",
        // Reused from the landing page when it also runs a Meta Pixel, so the
        // browser event and this one collapse into a single conversion instead
        // of being counted twice.
        eventId: cleanText(input.eventId, 100) ?? leadResult.data.id,
        actionSource: "website",
        eventSourceUrl: cleanText(input.pageUrl, 500) ?? origin,
        identity: {
          email,
          phone,
          firstName,
          lastName,
          city: cleanText(input.city, 80),
          state: cleanText(input.state, 30),
          zip: cleanText(input.zip, 20),
        },
        attribution,
        context: {
          clientIpAddress: request.headers.get("cf-connecting-ip"),
          clientUserAgent: request.headers.get("user-agent"),
        },
        customData: { content_name: service },
      });
    }

    return Response.json({ accepted: true, leadId: leadResult.data.id }, { status: 201, headers });
  } catch (error) {
    const message = error instanceof SyntaxError ? "Request body must be valid JSON." : error instanceof Error ? error.message : "Submission failed.";
    return Response.json({ error: message }, { status: 400, headers });
  }
}
