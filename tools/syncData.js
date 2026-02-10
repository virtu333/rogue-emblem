import { copyFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sourceDir = join(__dirname, '..', 'data');
const targetDir = join(__dirname, '..', 'public', 'data');

const jsonFiles = readdirSync(sourceDir).filter(f => f.endsWith('.json'));

for (const file of jsonFiles) {
  copyFileSync(join(sourceDir, file), join(targetDir, file));
  console.log(`✓ ${file}`);
}

console.log(`\nSynced ${jsonFiles.length} files: data/ → public/data/`);
