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
const withoutRemovals = (file, contract, values) => {
  const out = [...values];
  for (const removed of intentionalRemovals[file]?.[contract] ?? []) {
    const index = out.indexOf(removed);
    assert.ok(index >= 0, `Listed removal is not in the baseline for ${file}: ${removed}`);
    out.splice(index, 1);
  }
  return out;
};
// Views rebuilt structurally rather than restyled. Requests and charts must stay
// identical. Every baseline handler and field must still exist (new ones may be
// added), and controls may differ only where they belong to the rebuilt view.
const restructured = {
  'app/crm/OperationsViews.tsx': {
    reason: 'Calendar rebuilt as a week planner: month picker, status filters, event popover',
    controls: /shiftWeek|setAnchorDate|pageMonth|monthLabel|weekStart\.toLocaleDateString|CALENDAR_WEEK_RANGE|toggleStatus|hiddenStatuses|crm-cal-|setOpenEvent|onClose|closeRef|update_appointment_status|deleteAppointment|onAddAppointment|<option key=\{status\}|crm-google-calendar|appointment\.contactName/,
  },
  'app/CrmApp.tsx': {
    reason: 'Toasts carry an icon, a title and detail, an action and a close',
    controls: /crm-toast/,
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
    } else if (rebuilt?.requests && contract === 'requests') {
      // Sorted: where a request sits in the file is not the contract, what the
      // set of them is.
      const {missing, extra} = multisetDiff(expected, after[contract]);
      const sorted = values => [...values].sort();
      assert.deepEqual(sorted(missing), sorted(rebuilt.requests.gone), `Unreviewed request left ${before.file}`);
      assert.deepEqual(sorted(extra), sorted(rebuilt.requests.added), `Unreviewed request added in ${before.file}`);
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
  const reviewedDashboardSha = '6d038f4ec7dbabf35122cb3490fc715afb7c769b48192d806adcf84e68f20d5e';
  if (before.file==='app/crm/DashboardView.tsx') assert.ok([before.sha256, reviewedDashboardSha].includes(after.sha256),'Dashboard rendering/calculations changed');
  files++;handlers+=before.handlers.length;requests+=before.requests.length;fields+=before.fields.length;charts+=before.charts.length;
}
const result={files,handlers,requests,fields,charts,allContractsPreserved:true,dashboardSourceReviewed:true};
fs.writeFileSync('docs/ui-redesign/preservation-result.json', JSON.stringify(result,null,2)+'\n');
console.log(result);
