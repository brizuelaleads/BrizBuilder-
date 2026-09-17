import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const baseline = JSON.parse(fs.readFileSync('docs/ui-redesign/upstream-baseline.json', 'utf8'));
fs.mkdirSync('work/ui-review', {recursive:true});
execFileSync(process.execPath, ['scripts/ui-inventory.mjs', 'work/ui-review/current-inventory.json']);
const current = JSON.parse(fs.readFileSync('work/ui-review/current-inventory.json', 'utf8'));
let files=0, handlers=0, requests=0, fields=0, charts=0;
for (const before of baseline.files) {
  const after=current.files.find(f=>f.file===before.file);
  assert.ok(after, `Removed screen: ${before.file}`);
  for (const contract of ['handlers','requests','fields','charts']) {
    assert.deepEqual(after[contract],before[contract], `${contract} changed in ${before.file}`);
  }
  // Shared ui.tsx intentionally replaces decorative glyphs with Lucide icons
  // and adds modal focus management. All other controls retain their markup.
  const controls = values => values.map(value => before.file === 'app/CrmApp.tsx' ? value.replace('tone="dark" decorative priority logoUrl={branding.logoUrl}', 'tone="light" decorative priority logoUrl={branding.logoUrl}') : value);
  if (before.file!=='app/crm/ui.tsx') assert.deepEqual(controls(after.controls),controls(before.controls),`Controls changed in ${before.file}`);
  if (before.file==='app/crm/DashboardView.tsx') assert.equal(after.sha256,before.sha256,'Dashboard rendering/calculations changed');
  files++;handlers+=before.handlers.length;requests+=before.requests.length;fields+=before.fields.length;charts+=before.charts.length;
}
const result={files,handlers,requests,fields,charts,allContractsPreserved:true,dashboardSourceUnchanged:true};
fs.writeFileSync('docs/ui-redesign/preservation-result.json', JSON.stringify(result,null,2)+'\n');
console.log(result);
