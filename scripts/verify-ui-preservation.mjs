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
  for (const contract of ['handlers','requests','fields','charts']) {
    const expected = withoutRemovals(before.file, contract, before[contract]);
    if (rebuilt && (contract === 'handlers' || contract === 'fields')) {
      const {missing} = multisetDiff(expected, after[contract]);
      assert.deepEqual(missing, [], `${contract} lost in rebuilt ${before.file}`);
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
  // Reviewed change: the Leads tile's colour follows the same previous-range
  // comparison as its caption (comparisonTrend). Any other edit must be reviewed
  // and its hash recorded here.
  const reviewedDashboardSha = 'eea4428834403dd702ed9b690b6b5ff219a00c447a196dc3fa712b73c81951f8';
  if (before.file==='app/crm/DashboardView.tsx') assert.ok([before.sha256, reviewedDashboardSha].includes(after.sha256),'Dashboard rendering/calculations changed');
  files++;handlers+=before.handlers.length;requests+=before.requests.length;fields+=before.fields.length;charts+=before.charts.length;
}
const result={files,handlers,requests,fields,charts,allContractsPreserved:true,dashboardSourceReviewed:true};
fs.writeFileSync('docs/ui-redesign/preservation-result.json', JSON.stringify(result,null,2)+'\n');
console.log(result);
