import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const adminEmail = "admin@brizbuilder.local";

function authHeaders(email = adminEmail, name = "Luciano Brizuela") {
  return {
    "oai-authenticated-user-email": email,
    "oai-authenticated-user-full-name": encodeURIComponent(name),
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  };
}

test("Phase 1 CRM authentication, tenant isolation, imports, custom data, companies, and opportunities", async () => {
  const mf = new Miniflare({
    scriptPath: path.join(root, "dist/server/index.js"),
    modules: true,
    modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
    compatibilityDate: "2026-05-22",
    compatibilityFlags: ["nodejs_compat"],
    d1Databases: { DB: "crm-phase-one-test" },
  });

  try {
    const anonymous = await mf.dispatchFetch("http://crm.test/api/crm");
    assert.equal(anonymous.status, 401, "protected API rejects anonymous requests");

    const adminResponse = await mf.dispatchFetch("http://crm.test/api/crm", { headers: authHeaders() });
    assert.equal(adminResponse.status, 200);
    const adminBody = await adminResponse.json();
    assert.equal(adminBody.data.organization.name, "Brizuela Leads");
    assert.equal(adminBody.data.viewer.role, "AGENCY_OWNER");
    assert.ok(adminBody.data.clients.some((client) => client.businessName === "Segovia Pest Management"));
    assert.ok(adminBody.data.leads.length >= 8, "realistic seed leads are available");
    assert.ok(adminBody.data.companies.length >= 2, "realistic company seed data is available");
    assert.ok(adminBody.data.customFields.length >= 3, "custom field definitions are persisted");
    assert.ok(adminBody.data.customValues.some((value) => value.valueKey === "custom.offer"));
    assert.ok(adminBody.data.featureFlags.some((flag) => flag.moduleKey === "crm" && flag.enabled));
    assert.ok(adminBody.data.featureFlags.some((flag) => flag.moduleKey === "communications" && !flag.enabled));
    assert.ok(adminBody.data.viewer.permissions.includes("audit.read"));

    const invalidOrigin = await mf.dispatchFetch("http://crm.test/api/crm", {
      method: "POST",
      headers: { ...authHeaders(), "content-type": "application/json", origin: "https://attacker.example" },
      body: JSON.stringify({ action: "create_lead" }),
    });
    assert.equal(invalidOrigin.status, 403, "cross-origin writes are rejected");

    const segovia = adminBody.data.clients.find((client) => client.businessName === "Segovia Pest Management");
    const createLead = await mf.dispatchFetch("http://crm.test/api/crm", {
      method: "POST",
      headers: { ...authHeaders(), "content-type": "application/json", origin: "http://crm.test" },
      body: JSON.stringify({ action: "create_lead", clientId: segovia.id, firstName: "Demo", lastName: "Customer", phone: "(512) 555-0199", serviceRequested: "General pest control", source: "Manual", estimatedValueCents: 15000 }),
    });
    assert.equal(createLead.status, 200);
    const createdLeadId = (await createLead.json()).result.id;

    const moveLead = await mf.dispatchFetch("http://crm.test/api/crm", {
      method: "POST",
      headers: { ...authHeaders(), "content-type": "application/json", origin: "http://crm.test" },
      body: JSON.stringify({ action: "move_lead", leadId: createdLeadId, stageId: "stage_qualified" }),
    });
    assert.equal(moveLead.status, 200);

    const refreshed = await mf.dispatchFetch("http://crm.test/api/crm", { headers: authHeaders() });
    const refreshedBody = await refreshed.json();
    const createdLead = refreshedBody.data.leads.find((lead) => lead.id === createdLeadId);
    assert.equal(createdLead.stageId, "stage_qualified");
    assert.equal(createdLead.status, "QUALIFIED");

    const db = await mf.getD1Database("DB");
    const history = await db.prepare("SELECT COUNT(*) AS total FROM lead_stage_history WHERE lead_id = ?").bind(createdLeadId).first();
    assert.equal(Number(history.total), 1, "pipeline history is recorded");

    const createCompany = await mf.dispatchFetch("http://crm.test/api/crm", {
      method: "POST",
      headers: { ...authHeaders(), "content-type": "application/json", origin: "http://crm.test" },
      body: JSON.stringify({ action: "create_company", clientId: segovia.id, name: "Imported Demo Services", industry: "Facilities services", email: "office@imported-demo.example" }),
    });
    assert.equal(createCompany.status, 200);

    const importContacts = await mf.dispatchFetch("http://crm.test/api/crm", {
      method: "POST",
      headers: { ...authHeaders(), "content-type": "application/json", origin: "http://crm.test" },
      body: JSON.stringify({ action: "import_contacts", clientId: segovia.id, rows: [
        { firstName: "Taylor", lastName: "Morgan", phone: "(512) 555-0198", email: "taylor.morgan@example.com", company: "Imported Demo Services", tags: "Commercial; Priority", marketingConsent: "granted" },
        { firstName: "Ava", lastName: "Martinez", email: "ava.martinez@example.com" },
      ] }),
    });
    assert.equal(importContacts.status, 200);
    const importResult = (await importContacts.json()).result;
    assert.deepEqual(importResult, { imported: 1, skipped: 1, total: 2 });

    const afterImport = await mf.dispatchFetch("http://crm.test/api/crm", { headers: authHeaders() });
    const afterImportBody = await afterImport.json();
    const importedContact = afterImportBody.data.contacts.find((contact) => contact.email === "taylor.morgan@example.com");
    assert.ok(importedContact, "CSV contact was persisted");
    assert.ok(afterImportBody.data.companies.some((company) => company.name === "Imported Demo Services" && company.contactCount === 1), "imported company relationship was persisted");

    const createField = await mf.dispatchFetch("http://crm.test/api/crm", {
      method: "POST",
      headers: { ...authHeaders(), "content-type": "application/json", origin: "http://crm.test" },
      body: JSON.stringify({ action: "create_custom_field", clientId: segovia.id, entityType: "CONTACT", label: "Gate code", fieldKey: "gate_code", fieldType: "TEXT" }),
    });
    assert.equal(createField.status, 200);
    const customFieldId = (await createField.json()).result.id;

    const setFieldValue = await mf.dispatchFetch("http://crm.test/api/crm", {
      method: "POST",
      headers: { ...authHeaders(), "content-type": "application/json", origin: "http://crm.test" },
      body: JSON.stringify({ action: "set_custom_field_value", fieldId: customFieldId, entityId: importedContact.id, value: "Demo-only 2468" }),
    });
    assert.equal(setFieldValue.status, 200);

    const upsertValue = await mf.dispatchFetch("http://crm.test/api/crm", {
      method: "POST",
      headers: { ...authHeaders(), "content-type": "application/json", origin: "http://crm.test" },
      body: JSON.stringify({ action: "upsert_custom_value", clientId: segovia.id, label: "Seasonal headline", valueKey: "custom.seasonal_headline", value: "Protect your home this season" }),
    });
    assert.equal(upsertValue.status, 200);

    const afterCustomData = await mf.dispatchFetch("http://crm.test/api/crm", { headers: authHeaders() });
    const afterCustomDataBody = await afterCustomData.json();
    assert.ok(afterCustomDataBody.data.customFieldValues.some((value) => value.definitionId === customFieldId && value.entityId === importedContact.id && value.value === "Demo-only 2468"));
    assert.ok(afterCustomDataBody.data.customValues.some((value) => value.valueKey === "custom.seasonal_headline"));
    assert.ok(afterCustomDataBody.data.auditLogs.some((entry) => entry.action === "contacts.imported"), "auditable imports are visible to agency owners");
    const eventCount = await db.prepare("SELECT COUNT(*) AS total FROM domain_events WHERE organization_id = 'org_brizuela_leads'").first();
    assert.ok(Number(eventCount.total) >= 6, "domain outbox events are emitted for future workflows and webhooks");

    await db.prepare("INSERT INTO accounts (id, email, display_name, role, client_id, status) VALUES ('account_client_test', 'client@segovia.example', 'Segovia Client', 'client', 'client_segovia', 'active')").run();
    await db.prepare("INSERT INTO client_members (id, organization_id, client_id, account_id, role, status) VALUES ('client_member_test', 'org_brizuela_leads', ?, 'account_client_test', 'CLIENT_OWNER', 'active')").bind(segovia.id).run();

    const secondClient = await mf.dispatchFetch("http://crm.test/api/crm", {
      method: "POST",
      headers: { ...authHeaders(), "content-type": "application/json", origin: "http://crm.test" },
      body: JSON.stringify({ action: "create_client", businessName: "Demo Roofing Company", industry: "Roofing", city: "Austin", state: "TX" }),
    });
    assert.equal(secondClient.status, 200);

    const clientResponse = await mf.dispatchFetch("http://crm.test/api/crm", { headers: authHeaders("client@segovia.example", "Segovia Client") });
    const clientBody = await clientResponse.json();
    assert.equal(clientResponse.status, 200, JSON.stringify(clientBody));
    assert.equal(clientBody.data.viewer.role, "CLIENT_OWNER");
    assert.equal(clientBody.data.clients.length, 1, "client receives only its assigned business");
    assert.equal(clientBody.data.clients[0].id, segovia.id);
    assert.equal(clientBody.data.team.length, 0, "client cannot list agency members");
    assert.ok(clientBody.data.leads.every((lead) => lead.clientId === segovia.id), "lead records are tenant scoped");
    assert.ok(clientBody.data.contacts.every((contact) => contact.clientId === segovia.id), "contacts are tenant scoped");
    assert.ok(clientBody.data.companies.every((company) => company.clientId === segovia.id), "companies are tenant scoped");
    assert.ok(clientBody.data.customFields.every((field) => field.clientId === segovia.id), "custom fields are tenant scoped");
    assert.ok(clientBody.data.customValues.every((value) => value.clientId === segovia.id), "custom values are tenant scoped");
    assert.equal(clientBody.data.auditLogs.length, 0, "client roles cannot read agency audit logs");
    assert.ok(!clientBody.data.viewer.permissions.includes("audit.read"));

    const forbiddenClientCreate = await mf.dispatchFetch("http://crm.test/api/crm", {
      method: "POST",
      headers: { ...authHeaders("client@segovia.example", "Segovia Client"), "content-type": "application/json", origin: "http://crm.test" },
      body: JSON.stringify({ action: "create_client", businessName: "Not Allowed", industry: "HVAC" }),
    });
    assert.equal(forbiddenClientCreate.status, 403, "client roles cannot create clients");
  } finally {
    await mf.dispose();
  }
});
