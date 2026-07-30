import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [d1, supabase, websitesView, calendarView] = await Promise.all([
  readFile(new URL("../db/crm.ts", import.meta.url), "utf8"),
  readFile(new URL("../db/supabase-crm.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/crm/WebsitesView.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/crm/OperationsViews.tsx", import.meta.url), "utf8"),
]);

test("website deletion is permission checked and tenant scoped in both backends", () => {
  for (const source of [d1, supabase]) {
    assert.match(source, /action === "delete_website"[\s\S]*requirePermission\(context, "websites\.manage"\)/);
    assert.match(source, /action === "delete_website"[\s\S]*await requireClient\(context,/);
    assert.match(source, /action === "delete_website"[\s\S]*organization_id/);
    assert.match(source, /action === "delete_website"[\s\S]*website\.deleted/);
  }
});

test("appointment deletion is permission checked and tenant scoped in both backends", () => {
  for (const source of [d1, supabase]) {
    assert.match(source, /action === "delete_appointment"[\s\S]*requirePermission\(context, "appointments\.write"\)/);
    assert.match(source, /action === "delete_appointment"[\s\S]*await requireClient\(context,/);
    assert.match(source, /action === "delete_appointment"[\s\S]*organization_id/);
    assert.match(source, /action === "delete_appointment"[\s\S]*appointment\.deleted/);
  }
  assert.match(supabase, /action === "delete_appointment"[\s\S]*syncAppointmentToGoogleCalendar[\s\S]*status: "CANCELED"[\s\S]*\.from\("appointments"\)[\s\S]*\.delete\(\)/);
});

test("delete controls require explicit confirmation", () => {
  assert.match(websitesView, /window\.confirm\(`Delete \$\{website\.name\}/);
  assert.match(websitesView, /action: "delete_website"/);
  assert.match(calendarView, /window\.confirm\(`Delete the \$\{appointment\.serviceType\} appointment/);
  assert.match(calendarView, /action: "delete_appointment"/);
});