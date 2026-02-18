import { copyFileSync, readdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sourceDir = join(__dirname, '..', 'data');
const targetDir = join(__dirname, '..', 'public', 'data');

const sourceJsonFiles = readdirSync(sourceDir)
  .filter((file) => file.endsWith('.json'))
  .sort();
const targetJsonFiles = readdirSync(targetDir)
  .filter((file) => file.endsWith('.json'))
  .sort();
const sourceSet = new Set(sourceJsonFiles);
const staleTargetFiles = targetJsonFiles.filter((file) => !sourceSet.has(file));

for (const file of sourceJsonFiles) {
  copyFileSync(join(sourceDir, file), join(targetDir, file));
  console.log(`Copied ${file}`);
}

for (const staleFile of staleTargetFiles) {
  unlinkSync(join(targetDir, staleFile));
  console.log(`Removed stale ${staleFile}`);
}

console.log('');
console.log(`Synced ${sourceJsonFiles.length} files: data/ -> public/data/`);
console.log(`Pruned ${staleTargetFiles.length} stale files from public/data/`);
