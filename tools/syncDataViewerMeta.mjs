import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const metaPath = path.join(root, 'data', 'metaUpgrades.json');
const viewerPath = path.join(root, 'data-viewer.html');

const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
const viewer = fs.readFileSync(viewerPath, 'utf8');

const replacement = `DATA.metaUpgrades = ${JSON.stringify(meta)};`;
const pattern = /DATA\.metaUpgrades\s*=\s*\[[\s\S]*?\];/;

if (!pattern.test(viewer)) {
  throw new Error('Could not find DATA.metaUpgrades block in data-viewer.html');
}

const updated = viewer.replace(pattern, replacement);
fs.writeFileSync(viewerPath, updated, 'utf8');

console.log('Synced DATA.metaUpgrades in data-viewer.html from data/metaUpgrades.json');
