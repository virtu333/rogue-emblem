import { existsSync, mkdirSync, readdirSync, cpSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sourceDir = join(__dirname, '..', 'assets');
const targetDir = join(__dirname, '..', 'public', 'assets');

function countFilesRecursively(dir) {
  let count = 0;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      count += countFilesRecursively(fullPath);
    } else if (entry.isFile()) {
      count += 1;
    }
  }
  return count;
}

if (!existsSync(sourceDir)) {
  console.log('assets/ not found; skipping asset sync.');
  process.exit(0);
}

if (!statSync(sourceDir).isDirectory()) {
  console.error('assets/ exists but is not a directory.');
  process.exit(1);
}

mkdirSync(targetDir, { recursive: true });
cpSync(sourceDir, targetDir, { recursive: true, force: true });

const fileCount = countFilesRecursively(sourceDir);
console.log(`Synced ${fileCount} asset files: assets/ -> public/assets/`);
