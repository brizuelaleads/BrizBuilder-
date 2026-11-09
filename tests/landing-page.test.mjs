import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
const read=(rel)=>fs.readFileSync(new URL(`../${rel}`,import.meta.url),'utf8');
const shell=read('app/auth/WorkspaceShell.tsx');
const source=read('app/page.tsx');
test('entry pages retain account help and legal destinations',()=>{
 for(const target of ['/privacy','/terms','mailto:brizuelaleads@gmail.com'])assert.ok(shell.includes(`href="${target}"`));
 assert.match(shell,/Skip to content/);
 assert.match(source,/id="main"/);
 assert.match(read('app/auth/SignInPanel.tsx'),/id="main"/);
});
test('landing page sends clients and team to sign-in and shows sample CRM captures',()=>{
 assert.match(shell,/<BrandLogo/);
 assert.match(shell,/<AuraBackground/);
 assert.match(source,/<WorkspaceShell/);
 assert.ok((source.match(/href="\/login"/g)??[]).length>=2,'landing links to sign-in from header and hero');
 assert.match(source,/mailto:brizuelaleads@gmail.com/);
 assert.match(read('app/login/page.tsx'),/<SignInPanel/);
 const showcase=read('app/components/CrmShowcase.tsx');
 assert.match(source,/<CrmShowcase \/>/);
 assert.match(showcase,/from "motion\/react"/);
 assert.match(showcase,/reducedMotion="user"/,'animation honours reduced-motion settings');
 for(const shot of ['dashboard','pipeline','conversations']){
  assert.match(showcase,new RegExp(`/landing/crm-${shot}\\.webp`));
  assert.ok(fs.statSync(new URL(`../public/landing/crm-${shot}.webp`,import.meta.url)).size>10000,`${shot} capture exists`);
 }
 assert.match(showcase,/Sample records shown/);
 for(const file of [read('app/auth/SignInPanel.tsx'),read('app/auth/AuraBackground.tsx')])assert.doesNotMatch(file,/next\/image|<img|\.webp|\.png|\.jpe?g/);
 assert.doesNotMatch(source,/landing-dashboard-dark|productShowcases|platformFeatures/);
});

test('workspace sign-in posts through existing authentication with password recovery',()=>{
 const form=read('app/WorkspaceLogin.tsx');
 assert.match(form,/action="\/api\/auth\/login" method="post"/);
 assert.match(form,/name="return_to" value=\{returnTo\}/);
 assert.match(form,/autoComplete="current-password"/);
 assert.match(form,/href="\/forgot-password"/);
});
