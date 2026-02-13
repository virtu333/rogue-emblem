// fullrun-slices.js - Deterministic scenario slices for strict PR gating.

export const FULLRUN_SLICES = {
  act1_pressure_normal: {
    description: 'Normal difficulty opening stability and pacing.',
    args: [
      '--seed-start', '1',
      '--seed-end', '12',
      '--difficulty', 'normal',
      '--mode', 'strict',
      '--min-avg-gold', '300',
      '--max-avg-gold', '700',
      '--max-avg-shop-spent', '200',
      '--max-avg-units-lost', '1.25',
      '--min-avg-nodes', '1.50',
      '--max-avg-turns', '15.00',
      '--max-avg-invalid-shop-entries', '0.00',
    ],
  },
  act1_pressure_hard: {
    description: 'Hard difficulty opening stress with bounded collapse speed.',
    args: [
      '--seed-start', '101',
      '--seed-end', '112',
      '--difficulty', 'hard',
      '--mode', 'strict',
      '--min-avg-gold', '250',
      '--max-avg-gold', '650',
      '--max-avg-shop-spent', '200',
      '--min-avg-nodes', '1.00',
      '--max-avg-turns', '10.00',
      '--max-avg-units-lost', '1.50',
      '--max-avg-invalid-shop-entries', '0.00',
    ],
  },
  progression_invincible: {
    description: 'Full progression telemetry under invincibility to catch economy/node flow regressions.',
    args: [
      '--seed-start', '201',
      '--seed-end', '206',
      '--difficulty', 'normal',
      '--invincibility',
      '--mode', 'strict',
      '--max-timeout-rate', '0.00',
      '--min-win-rate', '95.00',
      '--min-avg-nodes', '10.00',
      '--min-avg-gold', '4000',
      '--max-avg-gold', '6500',
      '--min-avg-shop-spent', '1000',
      '--max-avg-shop-spent', '6500',
      '--min-avg-recruits', '0.50',
      '--min-promotion-by-act2-rate', '10.00',
      '--max-promotion-by-act2-rate', '50.00',
      '--max-avg-units-lost', '0.00',
      '--max-avg-invalid-shop-entries', '0.00',
    ],
  },
};

export const FULLRUN_SLICE_SUITES = {
  pr: ['act1_pressure_normal', 'act1_pressure_hard', 'progression_invincible'],
};
