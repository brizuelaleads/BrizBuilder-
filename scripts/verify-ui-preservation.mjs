import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const baseline = JSON.parse(fs.readFileSync('docs/ui-redesign/upstream-baseline.json', 'utf8'));
fs.mkdirSync('work/ui-review', {recursive:true});
execFileSync(process.execPath, ['scripts/ui-inventory.mjs', 'work/ui-review/current-inventory.json']);
const current = JSON.parse(fs.readFileSync('work/ui-review/current-inventory.json', 'utf8'));
// In-page buttons that repeated a topbar action. Each opened the same modal as
// the topbar button, which keeps the same permission gate, so no capability is
// lost; the unused view props that fed them go with them. Every entry must still
// exist in the baseline and be absent now, so this cannot hide other changes.
const intentionalRemovals = {
  'app/CrmApp.tsx': {handlers: ['onImportContacts={() => setModal("contact-import")}', 'onAddTask={() => setModal("task")}', 'onAddClient={() => setModal("client")}']},
  'app/crm/FoundationViews.tsx': {
    handlers: ['onClick={onImportContacts}', 'onClick={onAddContact}', 'onClick={onAddCompany}'],
    controls: ['<button className="crm-button-secondary" onClick={onImportContacts}>Import CSV</button>', '<button className="crm-button-primary" onClick={onAddContact}>+ Add Contact</button>', '<button className="crm-button-primary" onClick={onAddCompany}>+ Add Company</button>'],
  },
  'app/crm/LeadsViews.tsx': {
    handlers: ['onClick={onAddLead}'],
    controls: ['<button className="crm-button-primary" onClick={onAddLead}> + Add lead </button>'],
    // The status and stage buttons became selects in the lead record rebuild,
    // so their type="button" attributes went with them. The actions themselves
    // are pinned by the replacements in `restructured` below.
    fields: ['type="button"', 'type="button"'],
  },
  'app/crm/OperationsViews.tsx': {
    handlers: ['onClick={onAddTask}', 'onClick={onAddAppointment}', 'onClick={onAddClient}', 'onClick={onInvite}'],
    controls: ['<button className="crm-button-primary" onClick={onAddTask}>+ New Task</button>', '<button className="crm-button-primary" onClick={onAddAppointment}>+ Book Appointment</button>', '<button className="crm-button-primary" onClick={onAddClient}>+ Add Sub-Account</button>', '<button className="crm-button-primary" onClick={onInvite}>+ Give Access</button>'],
  },
};
// Code that moved to another file rather than going away. Each listed item must
// be in the baseline of the file it left AND in the current file it moved to,
// so "moved" can never excuse something that was dropped.
const moves = {
  'app/crm/DashboardView.tsx': {
    // The trend charts moved unchanged to a shared module the Ads tab uses too.
    to: 'app/crm/dashboard-charts.tsx',
    handlers: ['onMouseLeave={() => setActive(null)}', 'onMouseEnter={() => setActive(index)}', 'onFocus={() => setActive(index)}', 'onBlur={() => setActive(null)}', 'onClick={() => setActive(index)}'],
    fields: ['type="button"'],
    charts: ['<svg className={`crm-dashboard-sparkline is-trend-${trend}`} viewBox="0 0 120 48" preserveAspectRatio="none" role="img" aria-label={label} >', '<svg viewBox="0 0 120 48" preserveAspectRatio="none" aria-hidden="true">'],
  },
  'app/crm/OperationsViews.tsx': {
    // Reports moved to its own file and was rebuilt as a client report; its
    // Print / Save PDF handler is unchanged.
    to: 'app/crm/ReportsView.tsx',
    handlers: ['onClick={() => window.print()}'],
  },
};
const withoutRemovals = (file, contract, values) => {
  const out = [...values];
  for (const removed of intentionalRemovals[file]?.[contract] ?? []) {
    const index = out.indexOf(removed);
    assert.ok(index >= 0, `Listed removal is not in the baseline for ${file}: ${removed}`);
    out.splice(index, 1);
  }
  const move = moves[file];
  if (move?.[contract]) {
    const destination = [...(current.files.find(f => f.file === move.to)?.[contract] ?? [])];
    for (const moved of move[contract]) {
      const index = out.indexOf(moved);
      assert.ok(index >= 0, `Listed move is not in the baseline for ${file}: ${moved}`);
      out.splice(index, 1);
      const there = destination.indexOf(moved);
      assert.ok(there >= 0, `Moved ${contract} is missing from ${move.to}: ${moved}`);
      destination.splice(there, 1);
    }
  }
  return out;
};
// Views rebuilt structurally rather than restyled. Requests and charts must stay
// identical. Every baseline handler and field must still exist (new ones may be
// added), and controls may differ only where they belong to the rebuilt view.
const restructured = {
  // Entry pages rebuilt as the glass sign-in (commit 330aade). What they submit
  // is pinned by tests/landing-page.test.mjs (action, method, return_to,
  // current-password, recovery link); here every field must still exist.
  'app/page.tsx': {
    reason: 'Landing rebuilt as a single screen: headline, sign-in links and the animated CRM showcase',
    controls: /./,
  },
  'app/forgot-password/page.tsx': {
    reason: 'Recovery form moved into the shared glass panel; same email field posting to /api/auth/forgot-password',
    controls: /./,
  },
  'app/login/page.tsx': {
    reason: 'Sign-in form moved into WorkspaceLogin, rendered through the shared SignInPanel; same fields posting to /api/auth/login',
    controls: /./,
    replacements: ['type="hidden"', 'name="return_to"', 'name="email"', 'type="email"', 'required', 'name="password"', 'type="password"', 'type="submit"']
      .map(lost => ({lost, now: /<SignInPanel returnTo=\{safeLoginReturnTo\(return_to\)\}/, why: `${lost} now lives in app/WorkspaceLogin.tsx, rendered by SignInPanel`})),
  },
  'app/crm/AdsView.tsx': {
    // Every figure the tab showed is still shown (pinned in
    // tests/ads-report.test.mjs); they are regrouped, not removed. The card/table
    // and more-metrics toggles are gone: there is one table showing everything.
    reason: 'Ads rebuilt as a one-page report: a report card (what every $1 brought back, spent against earned), the steps from seeing an ad to becoming a customer, day-by-day spend and leads beside the wider lead picture, one campaign table, and the campaign drawer',
    controls: /<th>(Campaign|Spend|Impressions|Clicks|Leads|CPL|Booked jobs|Won customers|Revenue|ROAS|Return|Ad|Cost per lead)<\/th>|<th scope="col">|<h3[ >]|<h4>|<h5>|crm-ads-disclosure|crm-ads-campaign-open|crm-ads-toast-close|onOpenConnections|campaign\.campaignName|onClick=\{\(\) => onOpenLead\(lead\)\}/,
    // New: spend and leads per day, two single-series bar charts on one day
    // axis, with the same numbers in a screen-reader table.
    charts: {gone: [], added: ['<DailyChart points={daily.points} byWeek={daily.byWeek} />']},
  },
  'app/crm/OperationsViews.tsx': {
    reason: 'Calendar rebuilt as a week planner: month picker, status filters, event popover. Settings gained an Appearance section (Glass backdrop picker). Reports moved to app/crm/ReportsView.tsx as a weekly/monthly client report.',
    controls: /<h2>Agency report<\/h2>|onClick=\{\(\) => window\.print\(\)\}>Print \/ Save PDF|<h3>(Lead progression|Volume and revenue|What to do next)<\/h3>|<th>(Source|Leads|Revenue)<\/th>|crm-appearance|appearance\.on|appearance\.blur|CRM_BACKDROPS|CRM_BACKDROP_BLURS|level\.|option\.id|<h3>Appearance<\/h3>|shiftWeek|setAnchorDate|pageMonth|monthLabel|weekStart\.toLocaleDateString|CALENDAR_WEEK_RANGE|toggleStatus|hiddenStatuses|crm-cal-|setOpenEvent|onClose|closeRef|update_appointment_status|deleteAppointment|onAddAppointment|<option key=\{status\}|crm-google-calendar|appointment\.contactName/,
  },
  'app/CrmApp.tsx': {
    reason: 'Toasts carry an icon, a title and detail, an action and a close; the sidebar foot gained the Classic/Glass theme switch',
    controls: /crm-toast|crm-theme-switch|chooseTheme|chooseBackdrop|chooseBackdropBlur|CRM_PICKER_THEMES|option\.label/,
    requests: {
      gone: [],
      added: [
        // New capability: the theme switch saves through the existing, validated
        // set_theme action (identity from the session, value from the allowlist).
        'fetch("/api/crm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "set_theme", theme: next }), })',
        // Settings > Appearance saves the Glass backdrop the same way, through
        // the validated set_backdrop action.
        'fetch("/api/crm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "set_backdrop", backdrop: next }), })',
        'fetch("/api/crm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "set_backdrop_blur", blur: next }), })',
      ],
    },
  },
  'app/crm/PaymentsView.tsx': {
    // Every Stripe handler, request and field is unchanged; what was added is a
    // provider tab switch, the agency's own account in the business picker, and
    // the Square workspace (app/crm/payments/SquareWorkspace.tsx), which sends
    // to /api/square rather than through mutate.
    reason: 'Payments gained Square invoicing beside Stripe: a provider tab switch and an option for the agency\'s own Square account.',
    controls: /setProvider|AGENCY_SCOPE|organizationName|<h3>Add a client first<\/h3>|<h3>Stripe connects one business at a time<\/h3>|<select value=\{clientId\} onChange=\{\(event\) => setLocalClient\(event\.target\.value\)\} >/,
    replacements: [
      {lost: '<select value={clientId} onChange={(event) => setLocalClient(event.target.value)} >', now: /value=\{agencySelected \? AGENCY_SCOPE : clientId\}\s*onChange=\{\(event\) => setLocalClient\(event\.target\.value\)\}/, why: 'the business picker also offers the agency\'s own Square account'},
    ],
  },
  'app/crm/WebsitesView.tsx': {
    reason: 'Websites rebuilt around a searchable list and a sectioned detail panel; the page header took the standard title. Nothing it sends changed.',
    controls: /crm-website|website\.id|setSelectedId|setEditing|setSection|crm-search|Add a Website|Add website|<h2>Websites<\/h2>|<h2>Send website leads|handoffMessage|Find a website/,
    replacements: [
      {lost: 'onClick={() => setSelectedId(website.id)}', now: /setSelectedId\(website\.id\); setDniLink\(""\); setSection\("overview"\); setCopied\(""\);/, why: 'picking a site also resets the panel it opens into'},
    ],
  },
  'app/crm/LeadsViews.tsx': {
    reason: 'Lead drawer rebuilt as the lead record: one column of cards, status and stage as selects, the estimated value editable in place, editing moved to LeadEditForm',
    controls: /crm-lead-|lead-record-|EstimatedValueEditor|setActiveTab|setEditing|tel:|sms:|mailto:|onAddLead|<h3>|"Lead status updated"|"Pipeline stage updated"|void archive\(\)|<option key=\{status\}|<option key=\{stage\.id\}|<option value=\{lead\.stageId/,
    // A rebuild may move a control, not drop it. Each handler the rebuild
    // dropped names the control that does its job now, and that successor has
    // to be present in this file or the check fails -- so the allowance above
    // cannot quietly cover a capability that simply went away.
    replacements: [
      {lost: '"Lead marked as won"', now: /className="lead-record-secondary" disabled=\{lead\.status === "WON"\}[^]*?"Lead marked as won"/, why: 'Mark as won moved into the lead management footer'},
      {lost: '"Lead status updated"', now: /<select value=\{lead\.status\}[^]*?"Lead status updated"/, why: 'the status menu became a select'},
      {lost: '"move_lead"', now: /<select value=\{lead\.stageId[^]*?"Pipeline stage updated"/, why: 'the stage stepper became a select'},
      {lost: '.crm-lead-value-inline', now: /<EstimatedValueEditor /, why: 'the estimated value is editable in place, so nothing has to focus it'},
      {lost: 'setActiveTab("tasks")', now: /onClick=\{\(\) => setActiveTab\("tasks"\)\}/, why: 'the task shortcut sits on the next-task row'},
      {lost: 'void archive()', now: /lead-record-archive" onClick=\{\(\) => void archive\(\)\}/, why: 'archive moved to the record footer'},
    ],
    // What a screen sends is the contract that matters most, so a rebuild does
    // not get to change it quietly: each request that left and each one that
    // arrived is listed exactly, and anything else fails the check.
    requests: {
      gone: [
        'mutate( { action: "update_lead", leadId: lead.id, status: "WON", finalRevenueCents: lead.finalRevenueCents || lead.estimatedValueCents, }, "Lead marked as won", )',
        'mutate( { action: "update_lead", leadId: lead.id, status, }, "Lead status updated", )',
        'mutate( { action: "move_lead", leadId: lead.id, stageId: stage.id, }, "Pipeline stage updated", )',
      ],
      added: [
        // Same payload as before, reformatted onto one line.
        'mutate({ action: "update_lead", leadId: lead.id, status: "WON", finalRevenueCents: lead.finalRevenueCents || lead.estimatedValueCents }, "Lead marked as won")',
        // The status select carries the chosen value, and setting WON here now
        // books the revenue the same way the Mark as won button always did.
        'mutate({ action: "update_lead", leadId: lead.id, status: event.target.value, ...(event.target.value === "WON" ? { finalRevenueCents: lead.finalRevenueCents || lead.estimatedValueCents } : {}) }, "Lead status updated")',
        // The stage select carries the chosen stage instead of a fixed one.
        'mutate({ action: "move_lead", leadId: lead.id, stageId: event.target.value }, "Pipeline stage updated")',
        // New capability: the lead record can set the linked appointment's
        // status, which the calendar already allowed for the same records.
        'mutate({ action: "update_appointment_status", appointmentId: linkedAppointment.id, status: event.target.value }, "Appointment status updated in the calendar")',
      ],
    },
  },
};
const multisetDiff = (expected, actual) => {
  const missing = [...expected];
  const extra = [];
  for (const value of actual) {
    const index = missing.indexOf(value);
    if (index >= 0) missing.splice(index, 1);
    else extra.push(value);
  }
  return {missing, extra};
};
let files=0, handlers=0, requests=0, fields=0, charts=0;
for (const before of baseline.files) {
  const after=current.files.find(f=>f.file===before.file);
  assert.ok(after, `Removed screen: ${before.file}`);
  const rebuilt = restructured[before.file];
  // A rebuild is allowed to move a control, not to drop one. Every replacement
  // must name something the baseline really had, and the successor doing its job
  // must be in the file today -- checked against the source, not the inventory,
  // so a renamed class or a deleted select is caught here rather than excused.
  for (const swap of rebuilt?.replacements ?? []) {
    const had = [...before.handlers, ...before.controls].some(value => value.includes(swap.lost));
    assert.ok(had, `Listed replacement is not in the baseline for ${before.file}: ${swap.lost}`);
    const source = fs.readFileSync(before.file, 'utf8').replaceAll('\r\n', '\n');
    assert.match(source, swap.now, `Replacement gone from ${before.file}: ${swap.why}`);
  }
  const explained = value => (rebuilt?.replacements ?? []).some(swap => value.includes(swap.lost));
  for (const contract of ['handlers','requests','fields','charts']) {
    const expected = withoutRemovals(before.file, contract, before[contract]);
    if (rebuilt && (contract === 'handlers' || contract === 'fields')) {
      const {missing} = multisetDiff(expected, after[contract]);
      assert.deepEqual(missing.filter(value => !explained(value)), [], `${contract} lost in rebuilt ${before.file}`);
    } else if (rebuilt?.[contract] && (contract === 'requests' || contract === 'charts')) {
      // Sorted: where a request or chart sits in the file is not the contract,
      // what the set of them is. Each one that left and each one that arrived
      // must be listed exactly.
      const {missing, extra} = multisetDiff(expected, after[contract]);
      const sorted = values => [...values].sort();
      assert.deepEqual(sorted(missing), sorted(rebuilt[contract].gone), `Unreviewed ${contract} left ${before.file}`);
      assert.deepEqual(sorted(extra), sorted(rebuilt[contract].added), `Unreviewed ${contract} added in ${before.file}`);
    } else {
      assert.deepEqual(after[contract], expected, `${contract} changed in ${before.file}`);
    }
  }
  // Shared ui.tsx intentionally replaces decorative glyphs with Lucide icons
  // and adds modal focus management. All other controls retain their markup.
  const controls = values => values.map(value => before.file === 'app/CrmApp.tsx' ? value.replace('tone="dark" decorative priority logoUrl={branding.logoUrl}', 'tone="light" decorative priority logoUrl={branding.logoUrl}') : value);
  if (rebuilt) {
    const {missing, extra} = multisetDiff(controls(withoutRemovals(before.file, 'controls', before.controls)), controls(after.controls));
    const outside = [...missing, ...extra].filter(value => !rebuilt.controls.test(value));
    assert.deepEqual(outside, [], `Controls outside the rebuilt view changed in ${before.file}`);
  }
  if (!rebuilt && before.file!=='app/crm/ui.tsx') assert.deepEqual(controls(after.controls),controls(withoutRemovals(before.file, 'controls', before.controls)),`Controls changed in ${before.file}`);
  // Reviewed changes, newest last. Any other edit must be reviewed and its hash
  // recorded here.
  //  1. The Leads tile's colour follows the same previous-range comparison as
  //     its caption (comparisonTrend).
  //  2. ROAS on the Ad spend tile, and that tile's trend arrow, divide only the
  //     revenue from leads carrying a Meta campaign id instead of every won
  //     job, so organic and referral revenue no longer inflates the return
  //     credited to ad spend (tests/meta-ads.test.mjs).
  //  3. The Marketing Snapshot names that figure outright -- a Revenue from Ads
  //     card showing the ad-attributed revenue, how many jobs it came from and
  //     its share of total revenue -- so the panel states what the ads earned
  //     instead of leaving it to be inferred from the Revenue tile.
  //  4. The trend charts and their date bucketing (timestamp, bucketSeries,
  //     seriesTrend, ratioTrend, trendLabel, DashboardSparkline,
  //     DashboardAreaChart) moved unchanged to app/crm/dashboard-charts.tsx so
  //     the Ads tab draws the same cards. The 200 moved lines were verified
  //     byte-identical and only imports were added; nothing the Dashboard
  //     renders or calculates changed.
  const reviewedDashboardSha = '715e1cf1a1c3b918572bacb237c2365efa9010f923f83c3a5965abcd31e4e024';
  if (before.file==='app/crm/DashboardView.tsx') assert.ok([before.sha256, reviewedDashboardSha].includes(after.sha256),'Dashboard rendering/calculations changed');
  files++;handlers+=before.handlers.length;requests+=before.requests.length;fields+=before.fields.length;charts+=before.charts.length;
}
const result={files,handlers,requests,fields,charts,allContractsPreserved:true,dashboardSourceReviewed:true};
fs.writeFileSync('docs/ui-redesign/preservation-result.json', JSON.stringify(result,null,2)+'\n');
console.log(result);
