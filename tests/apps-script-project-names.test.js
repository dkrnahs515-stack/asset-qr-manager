'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Apps Script deployable files use unique project names across script and HTML types', () => {
  const files = fs.readdirSync('apps-script')
    .filter(file => /\.(?:gs|js|html)$/i.test(file));

  const byProjectName = new Map();
  for (const file of files) {
    const projectName = path.basename(file, path.extname(file));
    const existing = byProjectName.get(projectName) || [];
    existing.push(file);
    byProjectName.set(projectName, existing);
  }

  const duplicates = [...byProjectName.entries()]
    .filter(([, names]) => names.length > 1)
    .map(([projectName, names]) => `${projectName}: ${names.join(', ')}`);

  assert.deepEqual(
    duplicates,
    [],
    `Apps Script rejects duplicate project file names even when extensions differ: ${duplicates.join(' / ')}`
  );
});
