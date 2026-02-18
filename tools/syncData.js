import { copyFileSync, readdirSync, unlinkSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sourceDir = join(__dirname, '..', 'data');
const targetDir = join(__dirname, '..', 'public', 'data');

function listJsonFiles(dir) {
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort();
}

export function syncDataDirs(source = sourceDir, target = targetDir, options = {}) {
  const logger = typeof options.logger === 'function' ? options.logger : console.log;
  const sourceJsonFiles = listJsonFiles(source);
  const targetJsonFiles = listJsonFiles(target);
  const sourceSet = new Set(sourceJsonFiles);
  const staleTargetFiles = targetJsonFiles.filter((file) => !sourceSet.has(file));

  for (const file of sourceJsonFiles) {
    copyFileSync(join(source, file), join(target, file));
    logger(`Copied ${file}`);
  }

  for (const staleFile of staleTargetFiles) {
    unlinkSync(join(target, staleFile));
    logger(`Removed stale ${staleFile}`);
  }

  logger('');
  logger(`Synced ${sourceJsonFiles.length} files: data/ -> public/data/`);
  logger(`Pruned ${staleTargetFiles.length} stale files from public/data/`);

  return {
    syncedCount: sourceJsonFiles.length,
    prunedCount: staleTargetFiles.length,
    syncedFiles: sourceJsonFiles,
    prunedFiles: staleTargetFiles,
  };
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  syncDataDirs();
}
