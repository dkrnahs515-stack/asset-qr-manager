const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function inlineScripts(relativePath) {
  const source = read(relativePath);
  return [...source.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1].trim())
    .filter(Boolean);
}

test('Apps Script server files parse as JavaScript', () => {
  for (const file of [
    'apps-script/Core.js',
    'apps-script/CurrentStateCore.js',
    'apps-script/RuntimeConfigCore.js',
    'apps-script/QrCore.js',
    'apps-script/LabelPrintCore.js',
    'apps-script/RuntimeConfig.gs',
    'apps-script/Code.gs',
    'apps-script/Inspection.gs',
    'apps-script/FieldOps.gs',
    'apps-script/SchemaSetup.gs',
    'apps-script/CurrentState.gs',
    'apps-script/QrAdmin.gs',
    'apps-script/LabelPrint.gs',
    'apps-script/LabelPrintPreview.gs',
    'apps-script/LabelPrintCompletion.gs'
  ]) {
    assert.doesNotThrow(() => new Function(read(file)), `${file} should parse`);
  }
});

test('inline mobile client script parses as JavaScript', () => {
  const scripts = inlineScripts('apps-script/Index.html');
  assert.ok(scripts.length >= 1, 'Index.html should contain an inline application script');
  for (const script of scripts) {
    assert.doesNotThrow(() => new Function(script), 'inline application script should parse');
  }
});

test('inline label print panel script parses as JavaScript', () => {
  const scripts = inlineScripts('apps-script/LabelPrintPanel.html');
  assert.ok(scripts.length >= 1, 'LabelPrintPanel.html should contain an inline application script');
  for (const script of scripts) {
    assert.doesNotThrow(() => new Function(script), 'label print panel script should parse');
  }
});
