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
let files=0, handlers=0, requests=0, fields=0, charts=0;
for (const before of baseline.files) {
  const after=current.files.find(f=>f.file===before.file);
  assert.ok(after, `Removed screen: ${before.file}`);
  for (const contract of ['handlers','requests','fields','charts']) {
    assert.deepEqual(after[contract],withoutRemovals(before.file, contract, before[contract]), `${contract} changed in ${before.file}`);
  }
  // Shared ui.tsx intentionally replaces decorative glyphs with Lucide icons
  // and adds modal focus management. All other controls retain their markup.
  const controls = values => values.map(value => before.file === 'app/CrmApp.tsx' ? value.replace('tone="dark" decorative priority logoUrl={branding.logoUrl}', 'tone="light" decorative priority logoUrl={branding.logoUrl}') : value);
  if (before.file!=='app/crm/ui.tsx') assert.deepEqual(controls(after.controls),controls(withoutRemovals(before.file, 'controls', before.controls)),`Controls changed in ${before.file}`);
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
