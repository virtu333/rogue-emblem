// fullrun-slices.js - Deterministic scenario slices for strict PR gating.

export const FULLRUN_SLICES = {
  act1_pressure_normal: {
    description: 'Normal difficulty opening stability and pacing.',
    args: [
      '--seed-start', '1',
      '--seed-end', '12',
      '--difficulty', 'normal',
      '--mode', 'strict',
      '--max-avg-units-lost', '1.25',
      '--min-avg-nodes', '1.50',
      '--max-avg-turns', '15.00',
    ],
  },
  act1_pressure_hard: {
    description: 'Hard difficulty opening stress with bounded collapse speed.',
    args: [
      '--seed-start', '101',
      '--seed-end', '112',
      '--difficulty', 'hard',
      '--mode', 'strict',
      '--min-avg-nodes', '1.00',
      '--max-avg-turns', '10.00',
      '--max-avg-units-lost', '1.50',
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
      '--min-avg-recruits', '0.50',
      '--max-avg-units-lost', '0.00',
    ],
  },
};

export const FULLRUN_SLICE_SUITES = {
  pr: ['act1_pressure_normal', 'act1_pressure_hard', 'progression_invincible'],
};
