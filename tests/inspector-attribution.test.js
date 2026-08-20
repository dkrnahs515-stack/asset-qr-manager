const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

test('active-session home requires an explicit current inspector before continuing', () => {
  const html = read('apps-script/Index.html');
  assert.match(html, /현재 조사자/);
  assert.match(html, /disabled=\$\{busy\|\|!inspector\.trim\(\)\}[^>]*onClick=\$\{onContinue\}/);
});

test('server-side field mutations reject blank inspector names instead of writing 미지정', () => {
  const code = read('apps-script/Code.gs');
  const inspection = read('apps-script/Inspection.gs');
  const fieldOps = read('apps-script/FieldOps.gs');

  assert.match(code, /function requireInspector_\(value\)/);
  assert.match(inspection, /requireInspector_\(payload\.inspector\)/);
  assert.match(fieldOps, /requireInspector_\(payload\.inspector\)/);
});
