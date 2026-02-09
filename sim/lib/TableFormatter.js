// TableFormatter.js — Console table output, CSV, arg parsing, recommendations

/**
 * Print an aligned console table.
 * @param {string[]} columns - Column headers
 * @param {Array<object>} rows - Row data objects keyed by column name
 * @param {{ title?: string }} opts
 */
export function printTable(columns, rows, opts = {}) {
  if (opts.title) {
    console.log(`\n${'='.repeat(opts.title.length + 4)}`);
    console.log(`  ${opts.title}`);
    console.log('='.repeat(opts.title.length + 4));
  }

  // Calculate column widths
  const widths = {};
  for (const col of columns) {
    widths[col] = col.length;
  }
  for (const row of rows) {
    for (const col of columns) {
      const val = formatVal(row[col]);
      widths[col] = Math.max(widths[col], val.length);
    }
  }

  // Header
  const headerLine = columns.map(c => c.padEnd(widths[c])).join('  ');
  console.log(`\n${headerLine}`);
  console.log(columns.map(c => '-'.repeat(widths[c])).join('  '));

  // Rows
  for (const row of rows) {
    const line = columns.map(c => {
      const val = formatVal(row[c]);
      // Right-align numbers
      return typeof row[c] === 'number' ? val.padStart(widths[c]) : val.padEnd(widths[c]);
    }).join('  ');
    console.log(line);
  }
  console.log('');
}

function formatVal(v) {
  if (v === undefined || v === null) return '-';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(1);
  return String(v);
}

/**
 * Output rows as CSV.
 */
export function toCSV(columns, rows) {
  console.log(columns.join(','));
  for (const row of rows) {
    console.log(columns.map(c => {
      const v = row[c];
      if (v === undefined || v === null) return '';
      if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
      const s = String(v);
      return s.includes(',') ? `"${s}"` : s;
    }).join(','));
  }
}

/**
 * Parse CLI args into an options object.
 * @param {object} defaults - { trials: 200, level: 1, csv: false, seed: 42, ... }
 * @returns {object} merged options
 */
export function parseArgs(defaults) {
  const args = process.argv.slice(2);
  const opts = { ...defaults };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (key === 'csv') {
        opts.csv = true;
      } else if (key === 'verbose') {
        opts.verbose = true;
      } else if (key === 'help') {
        opts.help = true;
      } else if (i + 1 < args.length) {
        const val = args[i + 1];
        i++;
        // Parse as number if possible
        const num = Number(val);
        opts[key] = isNaN(num) ? val : num;
      }
    }
  }
  return opts;
}

/**
 * Print balance recommendations.
 * @param {Array<{ severity: 'INFO'|'WARNING'|'CRITICAL', label: string, detail: string, suggestion?: string }>} issues
 */
export function printRecommendations(issues) {
  if (issues.length === 0) {
    console.log('\n✓ No balance issues detected.\n');
    return;
  }

  console.log('\n' + '='.repeat(60));
  console.log('  RECOMMENDATIONS');
  console.log('='.repeat(60));

  const icons = { INFO: '[i]', WARNING: '[!]', CRITICAL: '[!!]' };

  for (const issue of issues) {
    const icon = icons[issue.severity] || '[?]';
    console.log(`\n${icon} ${issue.label}`);
    console.log(`    ${issue.detail}`);
    if (issue.suggestion) {
      console.log(`    -> ${issue.suggestion}`);
    }
  }
  console.log('');
}

/**
 * Print a section header.
 */
export function printHeader(title) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('='.repeat(60));
}

/**
 * Compute percentiles from a sorted array.
 */
export function percentiles(values, pcts = [10, 25, 50, 75, 90]) {
  const sorted = [...values].sort((a, b) => a - b);
  const result = {};
  for (const p of pcts) {
    const idx = Math.floor(sorted.length * p / 100);
    result[`P${p}`] = sorted[Math.min(idx, sorted.length - 1)];
  }
  return result;
}

/**
 * Compute mean and standard deviation.
 */
export function meanStd(values) {
  const n = values.length;
  if (n === 0) return { mean: 0, std: 0 };
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  return { mean, std: Math.sqrt(variance) };
}
