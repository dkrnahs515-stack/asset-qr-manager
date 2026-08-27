'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('label print UI installer has trigger-management scope without changing deployer execution mode', () => {
  const manifest = JSON.parse(fs.readFileSync('apps-script/appsscript.json', 'utf8'));
  const scopes = manifest.oauthScopes || [];

  assert.ok(
    scopes.includes('https://www.googleapis.com/auth/script.scriptapp'),
    'installLabelPrintUi uses ScriptApp trigger APIs and requires script.scriptapp scope'
  );
  assert.equal(manifest.webapp?.executeAs, 'USER_DEPLOYING');
});
