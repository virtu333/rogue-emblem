# Gaspar calculation results

Generated with the [calculation appendix](veteran-knight-calculations.md) against main at
`f5f748f12b1e4e25150732f9974384f45a81a0d3`. See [the spec](veteran-knight.md) for interpretation.

Percentages are diagnostic samples, not full-run shipping gates. The JSON records the
population, seeds, trial counts, limitations and all candidate results.

```json
{
  "engineRef": "f5f748f12b1e4e25150732f9974384f45a81a0d3",
  "trials": 6000,
  "seed": "LCG 1664525/1013904223; seeds in script",
  "limitations": [
    "No movement, Canto, healing, death catch-up, resource economy or full-run policy.",
    "Act 1: 595 generated rout maps/rung, 85 per non-boss row (0-6); first row Fighters only; three deployed; cavalry permitted.",
    "Offense: plain terrain unless noted; real 2RN, crits, counterattack ordering and Aegis.",
    "Survival: fresh full-HP random enemies initiate up to four rounds; bow uses range 2; Gaspar counters when legal; no healing.",
    "Enemy random learned skills, affixes, poison and status weapons omitted; do not treat as shipping gates.",
    "Act 2 falloff uses equal class weights and fixed enemy levels. Bosses use canonical promoted construction plus BOSS_STAT_BONUS; no throne/enrage/elite mods.",
    "Monte Carlo error around 50% is about +/-1.3 percentage points (95%) for 6000 independent trials; enemy population sampling adds uncertainty."
  ],
  "candidateComparison": {
    "original22HP4DEF": {
      "stats": {
        "HP": 22,
        "STR": 11,
        "MAG": 0,
        "SKL": 7,
        "SPD": 10,
        "DEF": 4,
        "RES": 2,
        "LCK": 3,
        "MOV": 6
      },
      "sword": {
        "potentialORKOPct": 44.9,
        "actualKillPct": 44.7,
        "meanCappedForecastDamagePct": 86.3,
        "meanTrueHitPct": 98.7,
        "meanCritPct": 0.3,
        "meanCounterForecastDamage": 7.8,
        "ownDeathPct": 0
      },
      "lance": {
        "potentialORKOPct": 11.4,
        "actualKillPct": 10.7,
        "meanCappedForecastDamagePct": 73.7,
        "meanTrueHitPct": 88.9,
        "meanCritPct": 0.3,
        "meanCounterForecastDamage": 8,
        "ownDeathPct": 0.1
      },
      "survivalSword": {
        "after1EnemyRoundsPct": 99.9,
        "after2EnemyRoundsPct": 97,
        "after3EnemyRoundsPct": 36.6,
        "after4EnemyRoundsPct": 9.8
      },
      "survivalLance": {
        "after1EnemyRoundsPct": 100,
        "after2EnemyRoundsPct": 86.2,
        "after3EnemyRoundsPct": 30.7,
        "after4EnemyRoundsPct": 6.9
      }
    },
    "control22HP4DEF": {
      "stats": {
        "HP": 22,
        "STR": 10,
        "MAG": 0,
        "SKL": 12,
        "SPD": 10,
        "DEF": 4,
        "RES": 2,
        "LCK": 3,
        "MOV": 6
      },
      "sword": {
        "potentialORKOPct": 44.5,
        "actualKillPct": 46.3,
        "meanCappedForecastDamagePct": 81.9,
        "meanTrueHitPct": 99.9,
        "meanCritPct": 2.3,
        "meanCounterForecastDamage": 7.8,
        "ownDeathPct": 0
      },
      "lance": {
        "potentialORKOPct": 4.8,
        "actualKillPct": 7,
        "meanCappedForecastDamagePct": 69.1,
        "meanTrueHitPct": 96.2,
        "meanCritPct": 2.3,
        "meanCounterForecastDamage": 8,
        "ownDeathPct": 0.1
      },
      "survivalSword": {
        "after1EnemyRoundsPct": 99.9,
        "after2EnemyRoundsPct": 96.9,
        "after3EnemyRoundsPct": 36.7,
        "after4EnemyRoundsPct": 9.9
      },
      "survivalLance": {
        "after1EnemyRoundsPct": 100,
        "after2EnemyRoundsPct": 85.6,
        "after3EnemyRoundsPct": 29.6,
        "after4EnemyRoundsPct": 6.6
      }
    },
    "revised20HP5DEF": {
      "stats": {
        "HP": 20,
        "STR": 10,
        "MAG": 0,
        "SKL": 12,
        "SPD": 10,
        "DEF": 5,
        "RES": 2,
        "LCK": 3,
        "MOV": 6
      },
      "sword": {
        "potentialORKOPct": 44.5,
        "actualKillPct": 46.3,
        "meanCappedForecastDamagePct": 81.9,
        "meanTrueHitPct": 99.9,
        "meanCritPct": 2.3,
        "meanCounterForecastDamage": 6.9,
        "ownDeathPct": 0
      },
      "lance": {
        "potentialORKOPct": 4.8,
        "actualKillPct": 7,
        "meanCappedForecastDamagePct": 69.1,
        "meanTrueHitPct": 96.2,
        "meanCritPct": 2.3,
        "meanCounterForecastDamage": 7.1,
        "ownDeathPct": 0.1
      },
      "survivalSword": {
        "after1EnemyRoundsPct": 99.9,
        "after2EnemyRoundsPct": 96.9,
        "after3EnemyRoundsPct": 41.4,
        "after4EnemyRoundsPct": 12.2
      },
      "survivalLance": {
        "after1EnemyRoundsPct": 100,
        "after2EnemyRoundsPct": 86.1,
        "after3EnemyRoundsPct": 33.9,
        "after4EnemyRoundsPct": 8.3
      }
    },
    "revised20HP6DEF": {
      "stats": {
        "HP": 20,
        "STR": 10,
        "MAG": 0,
        "SKL": 12,
        "SPD": 10,
        "DEF": 6,
        "RES": 2,
        "LCK": 3,
        "MOV": 6
      },
      "sword": {
        "potentialORKOPct": 44.5,
        "actualKillPct": 46.3,
        "meanCappedForecastDamagePct": 81.9,
        "meanTrueHitPct": 99.9,
        "meanCritPct": 2.3,
        "meanCounterForecastDamage": 6.1,
        "ownDeathPct": 0
      },
      "lance": {
        "potentialORKOPct": 4.8,
        "actualKillPct": 7,
        "meanCappedForecastDamagePct": 69.1,
        "meanTrueHitPct": 96.2,
        "meanCritPct": 2.3,
        "meanCounterForecastDamage": 6.3,
        "ownDeathPct": 0
      },
      "survivalSword": {
        "after1EnemyRoundsPct": 100,
        "after2EnemyRoundsPct": 99.6,
        "after3EnemyRoundsPct": 60,
        "after4EnemyRoundsPct": 23.1
      },
      "survivalLance": {
        "after1EnemyRoundsPct": 100,
        "after2EnemyRoundsPct": 93,
        "after3EnemyRoundsPct": 53,
        "after4EnemyRoundsPct": 18.1
      }
    },
    "recommended18HP6DEF": {
      "stats": {
        "HP": 18,
        "STR": 10,
        "MAG": 0,
        "SKL": 12,
        "SPD": 10,
        "DEF": 6,
        "RES": 2,
        "LCK": 3,
        "MOV": 6
      },
      "sword": {
        "potentialORKOPct": 44.5,
        "actualKillPct": 46.3,
        "meanCappedForecastDamagePct": 81.9,
        "meanTrueHitPct": 99.9,
        "meanCritPct": 2.3,
        "meanCounterForecastDamage": 6.1,
        "ownDeathPct": 0
      },
      "lance": {
        "potentialORKOPct": 4.8,
        "actualKillPct": 7,
        "meanCappedForecastDamagePct": 69.1,
        "meanTrueHitPct": 96.2,
        "meanCritPct": 2.3,
        "meanCounterForecastDamage": 6.3,
        "ownDeathPct": 0
      },
      "survivalSword": {
        "after1EnemyRoundsPct": 99.9,
        "after2EnemyRoundsPct": 97.1,
        "after3EnemyRoundsPct": 47.4,
        "after4EnemyRoundsPct": 15.5
      },
      "survivalLance": {
        "after1EnemyRoundsPct": 100,
        "after2EnemyRoundsPct": 86.5,
        "after3EnemyRoundsPct": 39.8,
        "after4EnemyRoundsPct": 11
      }
    },
    "alternative19HP6DEF": {
      "stats": {
        "HP": 19,
        "STR": 10,
        "MAG": 0,
        "SKL": 12,
        "SPD": 10,
        "DEF": 6,
        "RES": 2,
        "LCK": 3,
        "MOV": 6
      },
      "sword": {
        "potentialORKOPct": 44.5,
        "actualKillPct": 46.3,
        "meanCappedForecastDamagePct": 81.9,
        "meanTrueHitPct": 99.9,
        "meanCritPct": 2.3,
        "meanCounterForecastDamage": 6.1,
        "ownDeathPct": 0
      },
      "lance": {
        "potentialORKOPct": 4.8,
        "actualKillPct": 7,
        "meanCappedForecastDamagePct": 69.1,
        "meanTrueHitPct": 96.2,
        "meanCritPct": 2.3,
        "meanCounterForecastDamage": 6.3,
        "ownDeathPct": 0
      },
      "survivalSword": {
        "after1EnemyRoundsPct": 100,
        "after2EnemyRoundsPct": 99.1,
        "after3EnemyRoundsPct": 53.2,
        "after4EnemyRoundsPct": 18.9
      },
      "survivalLance": {
        "after1EnemyRoundsPct": 100,
        "after2EnemyRoundsPct": 91.1,
        "after3EnemyRoundsPct": 47,
        "after4EnemyRoundsPct": 14.4
      }
    },
    "alternative18HP7DEF": {
      "stats": {
        "HP": 18,
        "STR": 10,
        "MAG": 0,
        "SKL": 12,
        "SPD": 10,
        "DEF": 7,
        "RES": 2,
        "LCK": 3,
        "MOV": 6
      },
      "sword": {
        "potentialORKOPct": 44.5,
        "actualKillPct": 46.3,
        "meanCappedForecastDamagePct": 81.9,
        "meanTrueHitPct": 99.9,
        "meanCritPct": 2.3,
        "meanCounterForecastDamage": 5.3,
        "ownDeathPct": 0
      },
      "lance": {
        "potentialORKOPct": 4.8,
        "actualKillPct": 7,
        "meanCappedForecastDamagePct": 69.1,
        "meanTrueHitPct": 96.2,
        "meanCritPct": 2.3,
        "meanCounterForecastDamage": 5.4,
        "ownDeathPct": 0
      },
      "survivalSword": {
        "after1EnemyRoundsPct": 100,
        "after2EnemyRoundsPct": 99.8,
        "after3EnemyRoundsPct": 69.6,
        "after4EnemyRoundsPct": 31.3
      },
      "survivalLance": {
        "after1EnemyRoundsPct": 100,
        "after2EnemyRoundsPct": 93.3,
        "after3EnemyRoundsPct": 60.3,
        "after4EnemyRoundsPct": 25.3
      }
    },
    "skill7": {
      "stats": {
        "HP": 18,
        "STR": 10,
        "MAG": 0,
        "SKL": 7,
        "SPD": 10,
        "DEF": 6,
        "RES": 2,
        "LCK": 3,
        "MOV": 6
      },
      "sword": {
        "potentialORKOPct": 44.5,
        "actualKillPct": 44.3,
        "meanCappedForecastDamagePct": 81.9,
        "meanTrueHitPct": 98.7,
        "meanCritPct": 0.3,
        "meanCounterForecastDamage": 6.1,
        "ownDeathPct": 0
      },
      "lance": {
        "potentialORKOPct": 4.8,
        "actualKillPct": 4.6,
        "meanCappedForecastDamagePct": 69.1,
        "meanTrueHitPct": 88.9,
        "meanCritPct": 0.3,
        "meanCounterForecastDamage": 6.3,
        "ownDeathPct": 0.1
      },
      "survivalSword": {
        "after1EnemyRoundsPct": 99.9,
        "after2EnemyRoundsPct": 97.1,
        "after3EnemyRoundsPct": 47.3,
        "after4EnemyRoundsPct": 15.4
      },
      "survivalLance": {
        "after1EnemyRoundsPct": 100,
        "after2EnemyRoundsPct": 86.6,
        "after3EnemyRoundsPct": 39.9,
        "after4EnemyRoundsPct": 11.1
      }
    },
    "skill10": {
      "stats": {
        "HP": 18,
        "STR": 10,
        "MAG": 0,
        "SKL": 10,
        "SPD": 10,
        "DEF": 6,
        "RES": 2,
        "LCK": 3,
        "MOV": 6
      },
      "sword": {
        "potentialORKOPct": 44.5,
        "actualKillPct": 45.3,
        "meanCappedForecastDamagePct": 81.9,
        "meanTrueHitPct": 99.7,
        "meanCritPct": 1.4,
        "meanCounterForecastDamage": 6.1,
        "ownDeathPct": 0
      },
      "lance": {
        "potentialORKOPct": 4.8,
        "actualKillPct": 5.8,
        "meanCappedForecastDamagePct": 69.1,
        "meanTrueHitPct": 93.8,
        "meanCritPct": 1.4,
        "meanCounterForecastDamage": 6.3,
        "ownDeathPct": 0
      },
      "survivalSword": {
        "after1EnemyRoundsPct": 99.9,
        "after2EnemyRoundsPct": 97.1,
        "after3EnemyRoundsPct": 47.5,
        "after4EnemyRoundsPct": 15.4
      },
      "survivalLance": {
        "after1EnemyRoundsPct": 100,
        "after2EnemyRoundsPct": 86.7,
        "after3EnemyRoundsPct": 40,
        "after4EnemyRoundsPct": 11
      }
    }
  },
  "difficultyComparison": {
    "normal": {
      "stats": {
        "HP": 18,
        "STR": 10,
        "MAG": 0,
        "SKL": 12,
        "SPD": 10,
        "DEF": 6,
        "RES": 2,
        "LCK": 3,
        "MOV": 6
      },
      "sampleUnits": 2267,
      "composition": {
        "Fighter": 631,
        "Soldier": 469,
        "Cavalier": 394,
        "Archer": 390,
        "Myrmidon": 383
      },
      "sword": {
        "potentialORKOPct": 44.5,
        "actualKillPct": 46.3,
        "meanCappedForecastDamagePct": 81.9,
        "meanTrueHitPct": 99.9,
        "meanCritPct": 2.3,
        "meanCounterForecastDamage": 6.1,
        "ownDeathPct": 0
      },
      "lance": {
        "potentialORKOPct": 4.8,
        "actualKillPct": 7,
        "meanCappedForecastDamagePct": 69.1,
        "meanTrueHitPct": 96.2,
        "meanCritPct": 2.3,
        "meanCounterForecastDamage": 6.3,
        "ownDeathPct": 0
      },
      "survivalSword": {
        "after1EnemyRoundsPct": 99.9,
        "after2EnemyRoundsPct": 97.1,
        "after3EnemyRoundsPct": 47.4,
        "after4EnemyRoundsPct": 15.5
      },
      "survivalLance": {
        "after1EnemyRoundsPct": 100,
        "after2EnemyRoundsPct": 86.5,
        "after3EnemyRoundsPct": 39.8,
        "after4EnemyRoundsPct": 11
      }
    },
    "dusk": {
      "stats": {
        "HP": 19,
        "STR": 10,
        "MAG": 0,
        "SKL": 12,
        "SPD": 10,
        "DEF": 6,
        "RES": 2,
        "LCK": 3,
        "MOV": 6
      },
      "sampleUnits": 2853,
      "composition": {
        "Fighter": 806,
        "Myrmidon": 451,
        "Cavalier": 505,
        "Archer": 503,
        "Soldier": 588
      },
      "sword": {
        "potentialORKOPct": 40.6,
        "actualKillPct": 42.4,
        "meanCappedForecastDamagePct": 78.7,
        "meanTrueHitPct": 99.9,
        "meanCritPct": 2.1,
        "meanCounterForecastDamage": 6.6,
        "ownDeathPct": 0
      },
      "lance": {
        "potentialORKOPct": 1,
        "actualKillPct": 3.2,
        "meanCappedForecastDamagePct": 65,
        "meanTrueHitPct": 95.5,
        "meanCritPct": 2.1,
        "meanCounterForecastDamage": 7,
        "ownDeathPct": 0.1
      },
      "survivalSword": {
        "after1EnemyRoundsPct": 100,
        "after2EnemyRoundsPct": 95.9,
        "after3EnemyRoundsPct": 45.2,
        "after4EnemyRoundsPct": 13.6
      },
      "survivalLance": {
        "after1EnemyRoundsPct": 99.9,
        "after2EnemyRoundsPct": 83.7,
        "after3EnemyRoundsPct": 32.2,
        "after4EnemyRoundsPct": 6.9
      }
    },
    "hard": {
      "stats": {
        "HP": 20,
        "STR": 10,
        "MAG": 0,
        "SKL": 12,
        "SPD": 10,
        "DEF": 7,
        "RES": 2,
        "LCK": 3,
        "MOV": 6
      },
      "sampleUnits": 4040,
      "composition": {
        "Fighter": 1213,
        "Archer": 713,
        "Soldier": 755,
        "Cavalier": 644,
        "Myrmidon": 715
      },
      "sword": {
        "potentialORKOPct": 0,
        "actualKillPct": 1.5,
        "meanCappedForecastDamagePct": 55.4,
        "meanTrueHitPct": 99.7,
        "meanCritPct": 0.9,
        "meanCounterForecastDamage": 6.9,
        "ownDeathPct": 0.1
      },
      "lance": {
        "potentialORKOPct": 0,
        "actualKillPct": 0.9,
        "meanCappedForecastDamagePct": 51.8,
        "meanTrueHitPct": 92.4,
        "meanCritPct": 0.9,
        "meanCounterForecastDamage": 7.6,
        "ownDeathPct": 0.3
      },
      "survivalSword": {
        "after1EnemyRoundsPct": 99.9,
        "after2EnemyRoundsPct": 93.7,
        "after3EnemyRoundsPct": 37.2,
        "after4EnemyRoundsPct": 9.5
      },
      "survivalLance": {
        "after1EnemyRoundsPct": 99.7,
        "after2EnemyRoundsPct": 76.1,
        "after3EnemyRoundsPct": 18.2,
        "after4EnemyRoundsPct": 2.4
      }
    },
    "lunatic": {
      "stats": {
        "HP": 21,
        "STR": 10,
        "MAG": 0,
        "SKL": 12,
        "SPD": 10,
        "DEF": 8,
        "RES": 2,
        "LCK": 3,
        "MOV": 6
      },
      "sampleUnits": 4760,
      "composition": {
        "Fighter": 1498,
        "Cavalier": 739,
        "Archer": 865,
        "Myrmidon": 780,
        "Soldier": 878
      },
      "sword": {
        "potentialORKOPct": 0,
        "actualKillPct": 0,
        "meanCappedForecastDamagePct": 27.1,
        "meanTrueHitPct": 99,
        "meanCritPct": 0.1,
        "meanCounterForecastDamage": 7.9,
        "ownDeathPct": 0.5
      },
      "lance": {
        "potentialORKOPct": 0,
        "actualKillPct": 0.1,
        "meanCappedForecastDamagePct": 38.3,
        "meanTrueHitPct": 87,
        "meanCritPct": 0.1,
        "meanCounterForecastDamage": 8.9,
        "ownDeathPct": 1.4
      },
      "survivalSword": {
        "after1EnemyRoundsPct": 98.9,
        "after2EnemyRoundsPct": 82.2,
        "after3EnemyRoundsPct": 20.7,
        "after4EnemyRoundsPct": 3.4
      },
      "survivalLance": {
        "after1EnemyRoundsPct": 97.2,
        "after2EnemyRoundsPct": 41.2,
        "after3EnemyRoundsPct": 3.7,
        "after4EnemyRoundsPct": 0.2
      }
    }
  },
  "byClass": {
    "Fighter": {
      "sword": {
        "potentialORKOPct": 98.4,
        "actualKillPct": 98.5,
        "meanCappedForecastDamagePct": 99.9,
        "meanTrueHitPct": 100,
        "meanCritPct": 3.9,
        "meanCounterForecastDamage": 8.5,
        "ownDeathPct": 0
      },
      "lance": {
        "potentialORKOPct": 0,
        "actualKillPct": 3.6,
        "meanCappedForecastDamagePct": 60.9,
        "meanTrueHitPct": 95,
        "meanCritPct": 3.9,
        "meanCounterForecastDamage": 10.5,
        "ownDeathPct": 0
      }
    },
    "Soldier": {
      "sword": {
        "potentialORKOPct": 0,
        "actualKillPct": 5.3,
        "meanCappedForecastDamagePct": 67.9,
        "meanTrueHitPct": 100,
        "meanCritPct": 2.7,
        "meanCounterForecastDamage": 7.8,
        "ownDeathPct": 0
      },
      "lance": {
        "potentialORKOPct": 0,
        "actualKillPct": 2.6,
        "meanCappedForecastDamagePct": 56.6,
        "meanTrueHitPct": 96.9,
        "meanCritPct": 2.7,
        "meanCounterForecastDamage": 6.8,
        "ownDeathPct": 0
      }
    },
    "Cavalier": {
      "sword": {
        "potentialORKOPct": 0,
        "actualKillPct": 3.1,
        "meanCappedForecastDamagePct": 71.4,
        "meanTrueHitPct": 100,
        "meanCritPct": 1.6,
        "meanCounterForecastDamage": 7.6,
        "ownDeathPct": 0
      },
      "lance": {
        "potentialORKOPct": 0,
        "actualKillPct": 1.4,
        "meanCappedForecastDamagePct": 59.5,
        "meanTrueHitPct": 95.1,
        "meanCritPct": 1.6,
        "meanCounterForecastDamage": 6.6,
        "ownDeathPct": 0
      }
    },
    "Archer": {
      "sword": {
        "potentialORKOPct": 93.4,
        "actualKillPct": 93.5,
        "meanCappedForecastDamagePct": 97.4,
        "meanTrueHitPct": 100,
        "meanCritPct": 1.5,
        "meanCounterForecastDamage": 0,
        "ownDeathPct": 0
      },
      "lance": {
        "potentialORKOPct": 0,
        "actualKillPct": 1.5,
        "meanCappedForecastDamagePct": 82.9,
        "meanTrueHitPct": 96.2,
        "meanCritPct": 1.5,
        "meanCounterForecastDamage": 0,
        "ownDeathPct": 0
      }
    },
    "Myrmidon": {
      "sword": {
        "potentialORKOPct": 0,
        "actualKillPct": 0.5,
        "meanCappedForecastDamagePct": 62.1,
        "meanTrueHitPct": 99.7,
        "meanCritPct": 0.5,
        "meanCounterForecastDamage": 4.6,
        "ownDeathPct": 0.1
      },
      "lance": {
        "potentialORKOPct": 27.1,
        "actualKillPct": 27.1,
        "meanCappedForecastDamagePct": 93.9,
        "meanTrueHitPct": 98.6,
        "meanCritPct": 0.5,
        "meanCounterForecastDamage": 4.3,
        "ownDeathPct": 0
      }
    }
  },
  "supportSensitivity": {
    "edricAuraSword": {
      "potentialORKOPct": 44.5,
      "actualKillPct": 46.3,
      "meanCappedForecastDamagePct": 81.9,
      "meanTrueHitPct": 100,
      "meanCritPct": 2.3,
      "meanCounterForecastDamage": 6.1,
      "ownDeathPct": 0
    },
    "edricAuraLance": {
      "potentialORKOPct": 4.8,
      "actualKillPct": 7.1,
      "meanCappedForecastDamagePct": 69.1,
      "meanTrueHitPct": 99.6,
      "meanCritPct": 2.3,
      "meanCounterForecastDamage": 6.3,
      "ownDeathPct": 0
    },
    "forestEnemySword": {
      "potentialORKOPct": 38.9,
      "actualKillPct": 39.5,
      "meanCappedForecastDamagePct": 77.1,
      "meanTrueHitPct": 94.9,
      "meanCritPct": 2.3,
      "meanCounterForecastDamage": 6.1,
      "ownDeathPct": 0
    },
    "forestEnemyLance": {
      "potentialORKOPct": 0,
      "actualKillPct": 1.8,
      "meanCappedForecastDamagePct": 64.3,
      "meanTrueHitPct": 77.5,
      "meanCritPct": 2.3,
      "meanCounterForecastDamage": 6.3,
      "ownDeathPct": 0.1
    },
    "tradedNerfedRapier": {
      "potentialORKOPct": 63.2,
      "actualKillPct": 66.9,
      "meanCappedForecastDamagePct": 90,
      "meanTrueHitPct": 99.9,
      "meanCritPct": 7.3,
      "meanCounterForecastDamage": 6.1,
      "ownDeathPct": 0
    }
  },
  "feeding": {
    "Iron Sword": {
      "gasparKillPct": 6.8,
      "gasparDeathPct": 0,
      "edricKillPctOfAllTargets": 53.8,
      "edricKillPctOfSurvivingChippedTargets": 57.7,
      "combinedTwoActionsKillPct": 60.5
    },
    "Rapier 7": {
      "gasparKillPct": 6.8,
      "gasparDeathPct": 0,
      "edricKillPctOfAllTargets": 84.6,
      "edricKillPctOfSurvivingChippedTargets": 90.7,
      "combinedTwoActionsKillPct": 91.3
    },
    "Rapier 6": {
      "gasparKillPct": 6.8,
      "gasparDeathPct": 0,
      "edricKillPctOfAllTargets": 79.2,
      "edricKillPctOfSurvivingChippedTargets": 84.9,
      "combinedTwoActionsKillPct": 85.9
    }
  },
  "act2Falloff": {
    "3": {
      "composition": "equal weight across 11 attacking Act 2 base classes; not map-weighted",
      "sword": {
        "potentialORKOPct": 23.8,
        "actualKillPct": 26.2,
        "meanCappedForecastDamagePct": 69.8,
        "meanTrueHitPct": 99.8,
        "meanCritPct": 2.1,
        "meanCounterForecastDamage": 7,
        "ownDeathPct": 0.1
      },
      "lance": {
        "potentialORKOPct": 15.5,
        "actualKillPct": 17.4,
        "meanCappedForecastDamagePct": 74.2,
        "meanTrueHitPct": 96.1,
        "meanCritPct": 2.1,
        "meanCounterForecastDamage": 6.9,
        "ownDeathPct": 0
      },
      "survivalSword": {
        "after1EnemyRoundsPct": 99.9,
        "after2EnemyRoundsPct": 83.6,
        "after3EnemyRoundsPct": 32,
        "after4EnemyRoundsPct": 8.4
      },
      "survivalLance": {
        "after1EnemyRoundsPct": 100,
        "after2EnemyRoundsPct": 83.4,
        "after3EnemyRoundsPct": 35.1,
        "after4EnemyRoundsPct": 10
      }
    },
    "5": {
      "composition": "equal weight across 11 attacking Act 2 base classes; not map-weighted",
      "sword": {
        "potentialORKOPct": 12,
        "actualKillPct": 14.2,
        "meanCappedForecastDamagePct": 58.7,
        "meanTrueHitPct": 99.5,
        "meanCritPct": 1.7,
        "meanCounterForecastDamage": 7.9,
        "ownDeathPct": 0.4
      },
      "lance": {
        "potentialORKOPct": 5.2,
        "actualKillPct": 7,
        "meanCappedForecastDamagePct": 65.9,
        "meanTrueHitPct": 94.8,
        "meanCritPct": 1.7,
        "meanCounterForecastDamage": 8.2,
        "ownDeathPct": 0.4
      },
      "survivalSword": {
        "after1EnemyRoundsPct": 99.8,
        "after2EnemyRoundsPct": 66.8,
        "after3EnemyRoundsPct": 19.7,
        "after4EnemyRoundsPct": 3.8
      },
      "survivalLance": {
        "after1EnemyRoundsPct": 99.7,
        "after2EnemyRoundsPct": 59.7,
        "after3EnemyRoundsPct": 14.6,
        "after4EnemyRoundsPct": 2.4
      }
    },
    "6": {
      "composition": "equal weight across 11 attacking Act 2 base classes; not map-weighted",
      "sword": {
        "potentialORKOPct": 17.3,
        "actualKillPct": 19.4,
        "meanCappedForecastDamagePct": 62.6,
        "meanTrueHitPct": 99.2,
        "meanCritPct": 1.6,
        "meanCounterForecastDamage": 11,
        "ownDeathPct": 0.6
      },
      "lance": {
        "potentialORKOPct": 5.2,
        "actualKillPct": 6.7,
        "meanCappedForecastDamagePct": 67,
        "meanTrueHitPct": 93.9,
        "meanCritPct": 1.6,
        "meanCounterForecastDamage": 11.2,
        "ownDeathPct": 2.2
      },
      "survivalSword": {
        "after1EnemyRoundsPct": 99.3,
        "after2EnemyRoundsPct": 34.8,
        "after3EnemyRoundsPct": 9,
        "after4EnemyRoundsPct": 2
      },
      "survivalLance": {
        "after1EnemyRoundsPct": 97.4,
        "after2EnemyRoundsPct": 32.6,
        "after3EnemyRoundsPct": 8,
        "after4EnemyRoundsPct": 1.7
      }
    },
    "8": {
      "composition": "equal weight across 11 attacking Act 2 base classes; not map-weighted",
      "sword": {
        "potentialORKOPct": 7.3,
        "actualKillPct": 8.1,
        "meanCappedForecastDamagePct": 51.5,
        "meanTrueHitPct": 98.6,
        "meanCritPct": 1.4,
        "meanCounterForecastDamage": 11.9,
        "ownDeathPct": 3.5
      },
      "lance": {
        "potentialORKOPct": 0.7,
        "actualKillPct": 2.3,
        "meanCappedForecastDamagePct": 57.4,
        "meanTrueHitPct": 92.1,
        "meanCritPct": 1.4,
        "meanCounterForecastDamage": 12.8,
        "ownDeathPct": 10.5
      },
      "survivalSword": {
        "after1EnemyRoundsPct": 96,
        "after2EnemyRoundsPct": 27.9,
        "after3EnemyRoundsPct": 6.1,
        "after4EnemyRoundsPct": 1.2
      },
      "survivalLance": {
        "after1EnemyRoundsPct": 89,
        "after2EnemyRoundsPct": 21.6,
        "after3EnemyRoundsPct": 4.2,
        "after4EnemyRoundsPct": 0.8
      }
    }
  },
  "bosses": {
    "Iron Captain": {
      "level": 3,
      "className": "Cavalier",
      "sword": {
        "potentialORKOPct": 0,
        "actualKillPct": 0,
        "meanCappedForecastDamagePct": 27.7,
        "meanTrueHitPct": 98.8,
        "meanCritPct": 0,
        "meanCounterForecastDamage": 10,
        "ownDeathPct": 0.7
      },
      "lance": {
        "potentialORKOPct": 0,
        "actualKillPct": 0,
        "meanCappedForecastDamagePct": 43.9,
        "meanTrueHitPct": 89.8,
        "meanCritPct": 0,
        "meanCounterForecastDamage": 9,
        "ownDeathPct": 0.7
      },
      "survivalSword": {
        "after1EnemyRoundsPct": 99.4,
        "after2EnemyRoundsPct": 1.3,
        "after3EnemyRoundsPct": 0,
        "after4EnemyRoundsPct": 0
      },
      "survivalLance": {
        "after1EnemyRoundsPct": 99.4,
        "after2EnemyRoundsPct": 39.8,
        "after3EnemyRoundsPct": 5.2,
        "after4EnemyRoundsPct": 0.4
      }
    },
    "Warchief": {
      "level": 3,
      "className": "Fighter",
      "sword": {
        "potentialORKOPct": 0,
        "actualKillPct": 0,
        "meanCappedForecastDamagePct": 74.7,
        "meanTrueHitPct": 100,
        "meanCritPct": 0,
        "meanCounterForecastDamage": 11.3,
        "ownDeathPct": 0
      },
      "lance": {
        "potentialORKOPct": 0,
        "actualKillPct": 0,
        "meanCappedForecastDamagePct": 44.4,
        "meanTrueHitPct": 89.4,
        "meanCritPct": 0,
        "meanCounterForecastDamage": 13.3,
        "ownDeathPct": 0
      },
      "survivalSword": {
        "after1EnemyRoundsPct": 100,
        "after2EnemyRoundsPct": 48.9,
        "after3EnemyRoundsPct": 18.6,
        "after4EnemyRoundsPct": 6.8
      },
      "survivalLance": {
        "after1EnemyRoundsPct": 100,
        "after2EnemyRoundsPct": 11.9,
        "after3EnemyRoundsPct": 1.1,
        "after4EnemyRoundsPct": 0
      }
    },
    "Knight Commander": {
      "level": 12,
      "className": "Paladin",
      "sword": {
        "potentialORKOPct": 0,
        "actualKillPct": 0,
        "meanCappedForecastDamagePct": 2.3,
        "meanTrueHitPct": 91.4,
        "meanCritPct": 0,
        "meanCounterForecastDamage": 20.1,
        "ownDeathPct": 93.7
      },
      "lance": {
        "potentialORKOPct": 0,
        "actualKillPct": 0,
        "meanCappedForecastDamagePct": 15.7,
        "meanTrueHitPct": 74.7,
        "meanCritPct": 0,
        "meanCounterForecastDamage": 26.9,
        "ownDeathPct": 74.5
      },
      "survivalSword": {
        "after1EnemyRoundsPct": 5.9,
        "after2EnemyRoundsPct": 0,
        "after3EnemyRoundsPct": 0,
        "after4EnemyRoundsPct": 0
      },
      "survivalLance": {
        "after1EnemyRoundsPct": 25.8,
        "after2EnemyRoundsPct": 1.1,
        "after3EnemyRoundsPct": 0,
        "after4EnemyRoundsPct": 0
      }
    },
    "Archmage": {
      "level": 12,
      "className": "Sage",
      "sword": {
        "potentialORKOPct": 0,
        "actualKillPct": 0,
        "meanCappedForecastDamagePct": 31.2,
        "meanTrueHitPct": 97.2,
        "meanCritPct": 0,
        "meanCounterForecastDamage": 23.6,
        "ownDeathPct": 87.7
      },
      "lance": {
        "potentialORKOPct": 0,
        "actualKillPct": 0,
        "meanCappedForecastDamagePct": 46.2,
        "meanTrueHitPct": 80.1,
        "meanCritPct": 0,
        "meanCounterForecastDamage": 38.5,
        "ownDeathPct": 95.4
      },
      "survivalSword": {
        "after1EnemyRoundsPct": 12.3,
        "after2EnemyRoundsPct": 0.2,
        "after3EnemyRoundsPct": 0,
        "after4EnemyRoundsPct": 0
      },
      "survivalLance": {
        "after1EnemyRoundsPct": 4.5,
        "after2EnemyRoundsPct": 0,
        "after3EnemyRoundsPct": 0,
        "after4EnemyRoundsPct": 0
      }
    },
    "Dark Rider": {
      "level": 12,
      "className": "Dark Knight",
      "sword": {
        "potentialORKOPct": 0,
        "actualKillPct": 0,
        "meanCappedForecastDamagePct": 2.3,
        "meanTrueHitPct": 91.4,
        "meanCritPct": 0,
        "meanCounterForecastDamage": 19.1,
        "ownDeathPct": 83.7
      },
      "lance": {
        "potentialORKOPct": 0,
        "actualKillPct": 0,
        "meanCappedForecastDamagePct": 15.7,
        "meanTrueHitPct": 74.7,
        "meanCritPct": 0,
        "meanCounterForecastDamage": 24.6,
        "ownDeathPct": 60.3
      },
      "survivalSword": {
        "after1EnemyRoundsPct": 15.8,
        "after2EnemyRoundsPct": 0,
        "after3EnemyRoundsPct": 0,
        "after4EnemyRoundsPct": 0
      },
      "survivalLance": {
        "after1EnemyRoundsPct": 39.8,
        "after2EnemyRoundsPct": 1.8,
        "after3EnemyRoundsPct": 0.1,
        "after4EnemyRoundsPct": 0
      }
    }
  },
  "rapier": {
    "Fighter": {
      "enemyHP": 22,
      "might7": {
        "damagePerHit": 10,
        "attackCount": 2,
        "totalPotential": 20,
        "trueHitPct": 100
      },
      "might6": {
        "damagePerHit": 9,
        "attackCount": 2,
        "totalPotential": 18,
        "trueHitPct": 100
      }
    },
    "Soldier": {
      "enemyHP": 21,
      "might7": {
        "damagePerHit": 6,
        "attackCount": 2,
        "totalPotential": 12,
        "trueHitPct": 98.7
      },
      "might6": {
        "damagePerHit": 5,
        "attackCount": 2,
        "totalPotential": 10,
        "trueHitPct": 98.7
      }
    },
    "Cavalier": {
      "enemyHP": 20,
      "might7": {
        "damagePerHit": 13,
        "attackCount": 2,
        "totalPotential": 26,
        "trueHitPct": 97.6,
        "hpAfterOneGasparLanceHit": 7,
        "oneRapierHitFinishes": true
      },
      "might6": {
        "damagePerHit": 11,
        "attackCount": 2,
        "totalPotential": 22,
        "trueHitPct": 97.6,
        "hpAfterOneGasparLanceHit": 7,
        "oneRapierHitFinishes": true
      }
    },
    "Knight": {
      "enemyHP": 22,
      "might7": {
        "damagePerHit": 8,
        "attackCount": 2,
        "totalPotential": 16,
        "trueHitPct": 99.9
      },
      "might6": {
        "damagePerHit": 6,
        "attackCount": 2,
        "totalPotential": 12,
        "trueHitPct": 99.9
      }
    }
  },
  "growth": {
    "base": {
      "totalPointsPerLevel": 1.1722421500000002,
      "blankRollProbability": 0.47224214999999997,
      "fallbackStat": "HP",
      "expectedByStat": {
        "HP": 0.67224215,
        "STR": 0.1,
        "MAG": 0,
        "SKL": 0.15,
        "SPD": 0.1,
        "DEF": 0.05,
        "RES": 0.05,
        "LCK": 0.05
      }
    },
    "maxMeta": {
      "normal": {
        "perStatBonus": 13,
        "totalPointsPerLevel": 1.8771985619247935,
        "blankRollProbability": 0.1371985619247936,
        "fallbackStat": "HP",
        "expectedByStat": {
          "HP": 0.4671985619247936,
          "STR": 0.23,
          "MAG": 0.13,
          "SKL": 0.28,
          "SPD": 0.23,
          "DEF": 0.18,
          "RES": 0.18,
          "LCK": 0.18
        }
      },
      "dusk": {
        "perStatBonus": 11,
        "totalPointsPerLevel": 1.7480981205954174,
        "blankRollProbability": 0.16809812059541762,
        "fallbackStat": "HP",
        "expectedByStat": {
          "HP": 0.4780981205954176,
          "STR": 0.21,
          "MAG": 0.11,
          "SKL": 0.26,
          "SPD": 0.21,
          "DEF": 0.16,
          "RES": 0.16,
          "LCK": 0.16
        }
      },
      "hard": {
        "perStatBonus": 10,
        "totalPointsPerLevel": 1.6857113999999997,
        "blankRollProbability": 0.18571139999999997,
        "fallbackStat": "HP",
        "expectedByStat": {
          "HP": 0.48571139999999996,
          "STR": 0.2,
          "MAG": 0.1,
          "SKL": 0.25,
          "SPD": 0.2,
          "DEF": 0.15,
          "RES": 0.15,
          "LCK": 0.15
        }
      },
      "lunatic": {
        "perStatBonus": 6,
        "totalPointsPerLevel": 1.4533475946838337,
        "blankRollProbability": 0.2733475946838336,
        "fallbackStat": "HP",
        "expectedByStat": {
          "HP": 0.5333475946838335,
          "STR": 0.16,
          "MAG": 0.06,
          "SKL": 0.21,
          "SPD": 0.16,
          "DEF": 0.11,
          "RES": 0.11,
          "LCK": 0.11
        }
      }
    }
  },
  "xp": {
    "8": {
      "kill": 1,
      "nonKill": 1
    },
    "9": {
      "kill": 9,
      "nonKill": 2
    },
    "10": {
      "kill": 25,
      "nonKill": 10
    },
    "12": {
      "kill": 35,
      "nonKill": 20
    }
  }
}
```

