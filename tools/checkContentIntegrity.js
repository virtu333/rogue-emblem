import { validateContentContract } from '../src/data/validators/contentContractValidator.js';

const result = validateContentContract();

if (!result.ok) {
  console.error('[check:content] Content contract validation failed.');
  for (const issue of result.issues) {
    console.error(`  - ${issue}`);
  }
  process.exit(1);
}

console.log(
  `[check:content] OK: validated ${result.summary.accessories} accessories, ${result.summary.consumables} consumables, ${result.summary.acts} loot act slices (contract + loot references + accessory text coverage).`,
);
