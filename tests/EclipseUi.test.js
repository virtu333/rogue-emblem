import { describe, expect, it } from 'vitest';
import { describeLoomNode, loomShortLabel } from '../src/ui/loomModel.js';
import { nodeFrame, nodeLabel } from '../src/ui/RouteGraph.js';
import {
  actPhaseName,
  eclipseExplainer,
  fallCountdownText,
  runEclipseSummary,
  shadowProjectionLabel,
  shadowProjectionTone,
  shadowSummary,
  victoryShadowText,
} from '../src/ui/eclipseContent.js';
import { actCardContent, runEndContent, victoryContent } from '../src/ui/ceremonyContent.js';
import { sidebarCounters } from '../src/ui/battleSidebarDisplay.js';
import { mergeRunRecords } from '../src/engine/RunRecords.js';
import { ATMOSPHERE_GRADES, eclipseGrade, resolveAtmosphere } from '../src/art/atmosphereConfig.js';
import { drawEclipseSun, moonOffset } from '../src/art/eclipse/eclipseSun.js';
import { EclipseHudController, projectedShadow } from '../src/ui/EclipseHudController.js';
import { RunManager } from '../src/engine/RunManager.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const config = data.eclipse;

function eclipsedVillage() {
  return {
    id: 'act2_4_0',
    row: 4,
    col: 0,
    type: 'battle',
    edges: [],
    templateId: null,
    battleParams: {
      act: 'act2',
      objective: 'rout',
      row: 4,
      isEclipsed: true,
      isElite: true,
      levelRange: [5, 8],
    },
    eclipse: { fromType: 'shop', label: 'Burned village', fellAtShadow: 31, seen: true },
  };
}

describe('Loom model · eclipsed knots', () => {
  it('labels eclipsed knots and keeps what they were', () => {
    const node = eclipsedVillage();
    expect(loomShortLabel(node)).toBe('ECLIPSED');
    expect(nodeLabel(node)).toBe('Burned village');
    expect(nodeFrame(node, 'act2')).toBe(3); // still a village silhouette
    const battle = {
      ...eclipsedVillage(),
      eclipse: { fromType: 'battle', label: 'Eclipsed battle' },
    };
    expect(nodeFrame(battle, 'act2')).toBe(7); // an eclipsed battle reads elite
  });

  it('describes the loss, the stronger foes and the elite spoils', () => {
    const card = describeLoomNode(eclipsedVillage(), {
      state: 'live',
      enemyLevelBonus: 2,
      eliteLoot: { choices: 4, picks: 2 },
    });
    expect(card.kind).toBe('ECLIPSED');
    expect(card.eclipsed).toBe(true);
    expect(card.place).toBe('Burned village');
    expect(card.tags.map((t) => t.text)).toEqual(['Eclipsed', 'Foes Lv 7–10', 'Loot: pick 2 of 4']);
    expect(card.text).toMatch(/village burned/);
    expect(card.flavor).toBeNull();
    expect(card.warning).toBeNull();
  });

  it('warns on knots the dark takes soon, but not on cut ones', () => {
    const node = { id: 'act2_3_4', row: 3, col: 4, type: 'shop', edges: [] };
    const near = { near: true, remaining: 2 };
    expect(describeLoomNode(node, { state: 'future', eclipse: near }).warning).toBe(
      'The dark takes this in 2 more shadow',
    );
    expect(describeLoomNode(node, { state: 'cut', eclipse: near }).warning).toBeNull();
    expect(describeLoomNode(node, { state: 'live' }).warning).toBeNull();
  });
});

describe('Eclipse copy', () => {
  it('projection labels and tones', () => {
    expect(shadowProjectionLabel(0)).toBe('Sun holds');
    expect(shadowProjectionLabel(3)).toBe('Shadow +3');
    expect([0, 1, 3, 4, 6].map(shadowProjectionTone)).toEqual([
      'held',
      'rising',
      'rising',
      'dark',
      'dark',
    ]);
    expect(victoryShadowText(0)).toBe('Sun held');
    expect(victoryShadowText(2)).toBe('Shadow +2');
    expect(victoryShadowText(null)).toBe('');
    expect(fallCountdownText(1)).toBe('The dark takes this in 1 more shadow');
    expect(shadowSummary(58, config)).toBe('Umbral · 58 shadow');
  });

  it('explains the Eclipse from data', () => {
    const view = {
      shadow: 80,
      actShadow: 12,
      cap: 100,
      phase: { id: 'totality', name: 'Totality', index: 3 },
      nextFall: 2,
    };
    const info = eclipseExplainer(view, config, { kindlePrice: 1000 });
    const text = info.sections.flatMap((s) => s.lines).join(' ');
    expect(info.phase).toBe('Totality');
    expect(text).toMatch(/3 turns under par/);
    expect(text).toMatch(new RegExp(`lifts ${config.bossRelief}`));
    expect(text).toMatch(/−8, 1000 G here/);
    expect(text).toMatch(/1 level higher/);
    expect(text).toMatch(/as often as on Hard/);
    expect(text).toMatch(/1 more affix/);
    expect(text).toMatch(/falls in 2 more shadow/);
    const pale = eclipseExplainer(
      { ...view, shadow: 3, phase: { id: 'pale', name: 'Pale', index: 0 }, nextFall: null },
      config,
    );
    expect(pale.sections[1].lines).toEqual(['Nothing yet. The land is whole.']);
    expect(pale.sections[2].lines[0]).toMatch(/safe|No knot within reach/);
  });

  it('run summaries follow the run state', () => {
    const rm = new RunManager(data);
    rm.startRun({ runSeed: 3, applyBlessingsAtStart: false });
    rm.eclipse = { ...rm.eclipse, shadow: 76 };
    expect(runEclipseSummary(rm)).toBe('Totality · 76 shadow');
    expect(actPhaseName(rm)).toBe('Totality');
    rm.eclipse = { ...rm.eclipse, enabled: false };
    expect(runEclipseSummary(rm)).toBe('');
    expect(actPhaseName(rm)).toBe('');
    expect(actPhaseName(null)).toBe('');
  });
});

describe('ceremonies', () => {
  it('the victory band says whether the sun held', () => {
    const base = { objective: 'rout', turn: 7, par: 9, rating: 'A' };
    expect(victoryContent(base).sub).toBe('Turn 7 · Par 9 · Rank A');
    expect(victoryContent({ ...base, shadowGain: 0 }).sub).toBe(
      'Turn 7 · Par 9 · Rank A · Sun held',
    );
    expect(victoryContent({ ...base, shadowGain: 1 }).sub).toBe(
      'Turn 7 · Par 9 · Rank A · Shadow +1',
    );
    expect(victoryContent({ ...base, shadowGain: 0, shadowRelief: 3 }).sub).toBe(
      'Turn 7 · Par 9 · Rank A · Sun held · Sun flares −3',
    );
    // No Eclipse, no relief line.
    expect(victoryContent({ ...base, shadowRelief: 3 }).sub).toBe('Turn 7 · Par 9 · Rank A');
  });

  it('the act card carries the phase', () => {
    expect(actCardContent('act3', { phase: 'Umbral' }).kicker).toBe('Act III · Umbral');
    expect(actCardContent('act3').kicker).toBe('Act III');
  });

  it('the run end card carries the final shadow', () => {
    const end = runEndContent({
      result: 'victory',
      commander: 'Edric',
      actId: 'finalBoss',
      battlesWon: 19,
      eclipse: 'Waning · 45 shadow',
    });
    expect(end.meta).toMatch(/19 battles won · Waning · 45 shadow$/);
  });
});

describe('HUD and records', () => {
  it('the sidebar parser still reads the turn label (the Eclipse never joins it)', () => {
    expect(sidebarCounters('Turn: 4 / Par: 8 (A)', 1)).toBe('Par 8 · A | Rewinds 1');
    expect(sidebarCounters('Turn: 9 / Par: 8 (B) | Boss enrages next turn (turn 10)', 0)).toBe(
      'Par 8 · B | Rewinds 0',
    );
  });

  it('projects shadow from the scene turn and par', () => {
    const rm = new RunManager(data);
    rm.startRun({ runSeed: 3, applyBlessingsAtStart: false });
    const scene = { runManager: rm, battleParams: {}, turnPar: 8, turnManager: { turnNumber: 9 } };
    expect(projectedShadow(scene)).toBe(4);
    scene.turnManager.turnNumber = 5;
    expect(projectedShadow(scene)).toBe(0);
    expect(projectedShadow({ ...scene, battleParams: { tutorialMode: true } })).toBeNull();
    expect(projectedShadow({ battleParams: {} })).toBeNull();
    const hud = new EclipseHudController({ ...scene, events: null, add: null }).create();
    scene.turnManager.turnNumber = 10;
    hud.scene.turnManager = scene.turnManager;
    hud.sync();
    expect(hud.label()).toBe('Shadow +5');
    expect(hud.tone()).toBe('dark');
    hud.destroy();
  });

  it('keeps final shadow in victory records', () => {
    const [rec] = mergeRunRecords([
      { id: 'r1', endedAt: 5, actsCleared: 4, shadow: 58.7, roster: [] },
    ]);
    expect(rec.shadow).toBe(58);
    expect(mergeRunRecords([{ id: 'r2', endedAt: 1, roster: [] }])[0].shadow).toBeNull();
  });
});

describe('atmosphere darkens by phase (presentation only)', () => {
  it('leaves Pale untouched and deepens with the phase', () => {
    const g = ATMOSPHERE_GRADES.act2;
    expect(eclipseGrade(g, 0)).toEqual(g);
    const hollow = eclipseGrade(g, 4);
    expect(hollow.exposure).toBeLessThan(g.exposure);
    expect(hollow.vignette).toBeGreaterThan(g.vignette);
    expect(hollow.sat).toBeLessThan(g.sat);
  });

  it('applies through resolveAtmosphere, never in the tutorial', () => {
    const plain = resolveAtmosphere({ act: 'act4' });
    const umbral = resolveAtmosphere({ act: 'act4', eclipsePhase: 2 });
    expect(umbral.grade.exposure).toBeLessThan(plain.grade.exposure);
    expect(umbral.lightOptions.darkness).toBeGreaterThan(plain.lightOptions.darkness);
    const tutorial = resolveAtmosphere({ act: 'act1', isTutorial: true, eclipsePhase: 4 });
    expect(tutorial.grade).toEqual(resolveAtmosphere({ act: 'act1', isTutorial: true }).grade);
  });
});

describe('Eclipse medallion art', () => {
  function recorder() {
    const calls = [];
    const grad = { addColorStop: (...a) => calls.push(['stop', ...a]) };
    return new Proxy(
      { calls },
      {
        get(target, key) {
          if (key === 'calls') return calls;
          if (key === 'createRadialGradient' || key === 'createLinearGradient')
            return (...a) => {
              calls.push([key, ...a]);
              return grad;
            };
          return (...a) => calls.push([key, ...a]);
        },
        set(target, key, value) {
          calls.push(['set', key, value]);
          return true;
        },
      },
    );
  }

  it('slides the ink disc from beside the sun to its centre', () => {
    const whole = moonOffset(0);
    const total = moonOffset(1);
    expect(Math.hypot(whole.dx, whole.dy)).toBeGreaterThan(2);
    expect(total).toEqual({ dx: 0, dy: -0 });
    expect(Math.hypot(moonOffset(0.5).dx, moonOffset(0.5).dy)).toBeLessThan(
      Math.hypot(whole.dx, whole.dy),
    );
  });

  it('draws deterministically without touching Math.random', () => {
    const prev = Math.random;
    Math.random = () => {
      throw new Error('presentation must not draw from Math.random');
    };
    try {
      const a = recorder();
      const b = recorder();
      drawEclipseSun(a, { size: 28, shadow: 58, phaseIndex: 2, seed: 'm' });
      drawEclipseSun(b, { size: 28, shadow: 58, phaseIndex: 2, seed: 'm' });
      expect(JSON.stringify(a.calls)).toBe(JSON.stringify(b.calls));
      const c = recorder();
      drawEclipseSun(c, { size: 28, shadow: 12, phaseIndex: 0, seed: 'm' });
      expect(JSON.stringify(c.calls)).not.toBe(JSON.stringify(a.calls));
      // Umbral and deeper draw crimson fractures; Pale does not.
      const crimson = (r) => r.calls.some((x) => x[0] === 'set' && x[2] === '#cc4038');
      expect(crimson(a)).toBe(true);
      expect(crimson(c)).toBe(false);
    } finally {
      Math.random = prev;
    }
  });
});
