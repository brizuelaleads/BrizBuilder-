import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import ts from 'typescript';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const files = walk(path.join(root, 'app')).filter(f => /\.tsx$/.test(f));
const inventory = files.map(file => {
  const source = (process.argv[3]
    ? execFileSync('git', ['show', `${process.argv[3]}:${path.relative(root, file).replaceAll('\\', '/')}`], {encoding:'utf8'})
    : fs.readFileSync(file, 'utf8')).replaceAll('\r\n', '\n');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const entry = { file: path.relative(root, file).replaceAll('\\', '/'), sha256: crypto.createHash('sha256').update(source).digest('hex'), components: [], controls: [], fields: [], handlers: [], requests: [], charts: [], classes: [] };
  const compact = n => n.getText(ast).replace(/\s+/g, ' ').trim();
  function visit(n) {
    if (ts.isFunctionDeclaration(n) && n.name) entry.components.push(n.name.text);
    if (ts.isJsxAttribute(n)) {
      const name = n.name.getText(ast);
      if (/^on[A-Z]/.test(name)) entry.handlers.push(compact(n));
      if (['name','type','required','min','max','pattern','accept','multiple','disabled'].includes(name)) entry.fields.push(compact(n));
      if (name === 'className') entry.classes.push(compact(n.initializer ?? n));
    }
    if (ts.isJsxElement(n) && ['button','a','label','h1','h2','h3','th','option'].includes(n.openingElement.tagName.getText(ast))) entry.controls.push(compact(n));
    if (ts.isJsxSelfClosingElement(n) && ['input','select','textarea'].includes(n.tagName.getText(ast))) entry.controls.push(compact(n));
    if (ts.isCallExpression(n) && /fetch|mutate/.test(n.expression.getText(ast))) entry.requests.push(compact(n));
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      const tag = n.tagName.getText(ast);
      if (/Chart|Sparkline|svg/.test(tag)) entry.charts.push(compact(n));
    }
    ts.forEachChild(n, visit);
  }
  visit(ast);
  return entry;
});
const out = process.argv[2] ?? 'docs/ui-redesign/baseline.json';
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ capturedAt: new Date().toISOString(), files: inventory }, null, 2) + '\n');
console.log(JSON.stringify(inventory.filter(e => e.file.includes('/crm/') || e.file.includes('CrmApp')).map(e => ({ file: e.file, components: e.components, controls: e.controls.length, handlers: e.handlers.length, charts: e.charts.length })), null, 2));
