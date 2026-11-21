import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  connectRoute,
  callbackRoute,
  calendarApi,
  operationsView,
  styles,
  supabaseCrm,
] = await Promise.all([
  readFile(
    new URL(
      "../app/api/integrations/google-calendar/connect/route.ts",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL(
      "../app/api/integrations/google/callback/route.ts",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(new URL("../lib/google-calendar.ts", import.meta.url), "utf8"),
  readFile(
    new URL("../app/crm/OperationsViews.tsx", import.meta.url),
    "utf8",
  ),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  readFile(new URL("../db/supabase-crm.ts", import.meta.url), "utf8"),
]);

test("Google Calendar connect is authenticated, tenant-scoped, and state-bound", () => {
  assert.match(connectRoute, /getChatGPTUser\(\)/);
  assert.match(connectRoute, /beginSupabaseGoogleCalendarConnect\(user,\s*clientId\)/);
  assert.match(
    supabaseCrm,
    /beginSupabaseGoogleCalendarConnect[\s\S]*requirePermission\(context,\s*"calendar\.connect"\)/,
  );
  assert.match(
    supabaseCrm,
    /beginSupabaseGoogleCalendarConnect[\s\S]*await requireClient\(context,\s*clientId\)/,
  );
  assert.match(
    supabaseCrm,
    /provider:\s*GOOGLE_CALENDAR_PROVIDER[\s\S]*state_hash:\s*await stateHash\(state\)/,
  );
  assert.match(callbackRoute, /state\.startsWith\("calendar_"\)/);
  assert.match(
    supabaseCrm,
    /finishSupabaseGoogleCalendarConnect[\s\S]*\.eq\("state_hash",\s*await stateHash\(state\)\)/,
  );
});

test("calendar connection stays actionable in all-client workspaces", () => {
  assert.match(operationsView, /clients\.length === 1/);
  assert.match(operationsView, /crm-google-calendar-client-select/);
  assert.match(operationsView, /googleCalendarClientId/);
});

test("Calendar shows saved connection status before the schedule, even without appointments", () => {
  const connectionHelpers = supabaseCrm.slice(
    supabaseCrm.indexOf("function providerIsLinked"),
    supabaseCrm.indexOf("type StripeAccountSummary"),
  );
  assert.match(connectionHelpers, /if \(row\.provider === GOOGLE_CALENDAR_PROVIDER\)\s*return status === "connected" \|\| status === "attention";/);
  assert.match(connectionHelpers, /row\?\.provider === GOOGLE_CALENDAR_PROVIDER \|\| providerAccountStatus\(row\) === "active"/);
  const statusCard = operationsView.indexOf('className="crm-cal-card crm-cal-sync"');
  const schedule = operationsView.indexOf('className="crm-cal-layout"');
  assert.ok(statusCard >= 0 && statusCard < schedule);
  const controls = operationsView.slice(statusCard, schedule);
  assert.match(controls, /role="status"/);
  assert.match(controls, /googleCalendarLinked && canConnectGoogleCalendar/);
  assert.match(controls, /Disconnect Google Calendar/);
  assert.doesNotMatch(controls, /appointments\.length|leads\.length/);
});

test("Google refresh tokens stay encrypted and server-only", () => {
  assert.match(
    supabaseCrm,
    /finishSupabaseGoogleCalendarConnect[\s\S]*encryptGoogleSecret\(/,
  );
  assert.match(
    supabaseCrm,
    /refresh_token_ciphertext:\s*encrypted\.ciphertext/,
  );
  assert.doesNotMatch(
    supabaseCrm,
    /refresh_token:\s*refreshToken/,
  );
  assert.doesNotMatch(operationsView, /refreshToken|accessToken/);
});

test("calendar synchronization uses private event identity and no attendee updates", () => {
  assert.match(
    calendarApi,
    /privateExtendedProperty[\s\S]*brizbuilderAppointmentId/,
  );
  assert.match(calendarApi, /sendUpdates",\s*"none"/);
  assert.match(
    supabaseCrm,
    /syncAppointmentToGoogleCalendar[\s\S]*GOOGLE_CALENDAR_PROVIDER/,
  );
});

test("week calendar exposes the full 24-hour grid and owns its viewport scroll", () => {
  assert.match(operationsView, /top:\s*`\$\{hour \* 64/);
  assert.doesNotMatch(operationsView, /\(hour - 6\) \* 64/);
  assert.match(styles, /\.crm-week-calendar\s*\{[\s\S]*height:\s*calc\(100dvh - 128px\)/);
  assert.match(styles, /\.crm-week-calendar\s*\{[\s\S]*overflow:\s*auto/);
  assert.match(operationsView, /className="crm-week-calendar"[\s\S]*tabIndex=\{0\}/);
});
