import { settleAccessoryHpOwed } from '../engine/UnitManager.js';
import { revivalCatchUpPlan } from '../engine/RevivalCatchUp.js';
import { PromotionPathChooser } from './PromotionPathChooser.js';
import { promotionPathContent, projectUnit } from './growthContent.js';
import { growthCeremonies } from './GrowthCeremonyController.js';
import { MenuSurface, element as el, button } from './MenuSurface.js';
import { ChoicePicker } from './ChoicePicker.js';
import { withUnitFace } from './unitPortrait.js';
import { MobileRosterSheet } from './MobileRosterSheet.js';
import { saveServiceRun } from './serviceSave.js';
import {
  canPromote,
  resolvePromotionTargets,
  getDisplayLevel,
  reviveStarterWeapon,
  withIndefiniteArticle,
} from '../engine/UnitManager.js';
import { getReviveCost } from '../engine/RunManager.js';
import {
  churchPromotionBlock,
  promoteAtChurch,
  churchReviveBlock,
  reviveAtChurch,
  churchKindleBlock,
  kindleAtChurch,
} from '../engine/ChurchCommands.js';
import {
  ruinsChoice,
  chooseRuinsPath,
  ruinsChoiceBlock,
  chosenLine,
  healAtRuins,
  ruinsReviveBlock,
  reviveAtRuins,
} from '../engine/RuinsCommands.js';
import { eclipsePhase, kindlePrice } from '../engine/EclipseSystem.js';
import { createEclipseSunCanvas } from '../art/eclipse/eclipseSun.js';
import { CHURCH_PROMOTE_COST, RUINS_SHOP_MARKUP, INVENTORY_MAX } from '../utils/constants.js';
import { applyServiceVignette, prefersStill } from './itemMoments.js';
import { LEVEL_UP_CUE_WAIT_MS, playCue } from './ceremonyMusic.js';
// The sanctuary's band kicker: both paths before the choice, the chosen one after.
const RUINS_KICKER = Object.freeze({
  none: 'Heal or wares',
  rest: 'Rest · Heal · Revive',
  scavenge: 'Scavenge · Wares',
});
const ruinsMarkupPct = () => Math.round((RUINS_SHOP_MARKUP - 1) * 100);
// Revive preview: the weapon an unarmed fallen unit is handed back (reviveStarterWeapon).
const starterLine = (unit, gameData) => {
  const weapon = reviveStarterWeapon(unit, gameData?.weapons || [], INVENTORY_MAX);
  return weapon ? ` Comes back carrying ${withIndefiniteArticle(weapon.name)}.` : '';
};
export function ruinsPathLabel(path) {
  return path === 'rest'
    ? 'Rest — heal everyone, revive the fallen'
    : `Scavenge — the ruins' wares (+${ruinsMarkupPct()}%)`;
}
export class ChurchMenu {
  constructor(c) {
    this.c = c;
    this.scene = c.scene;
    this.status = '';
    this.open();
  }
  open() {
    if (this.surface || this.destroyed) return;
    this.surface = new MenuSurface(
      this.scene,
      this.scene._churchRuinsMode ? 'Ruins sanctuary' : 'Church',
      () => {
        if (!this.child) this.c.leaveChurchNode();
      },
    );
    this.surface.root.classList.add('service-menu');
    this.surface.header.querySelector('button').textContent = 'Leave';
    this.gold = el('span', '', 'shop-gold');
    this.surface.header.insertBefore(this.gold, this.surface.header.lastChild);
    this.render();
    this.surface.focusContent();
  }
  render(message) {
    if (!this.surface || this.surface.destroyed) return;
    if (message != null) this.status = message;
    const body = this.surface.body,
      run = this.scene.runManager;
    const scroll = body.scrollTop;
    body.replaceChildren();
    const ruins = !!this.scene._churchRuinsMode;
    // The Ruins: rest OR scavenge, one per node, kept on the run (RuinsCommands).
    const nodeId = this.scene._churchNode?.id;
    const path = ruins ? ruinsChoice(run, nodeId) : null;
    body.append(
      applyServiceVignette(this.surface.root, ruins ? 'ruins' : 'church', {
        title: ruins ? 'Ruins sanctuary' : 'Church',
        kicker: ruins ? RUINS_KICKER[path] || RUINS_KICKER.none : 'Heal · Revive · Promote',
        still: prefersStill(this.scene),
        backdrop: true,
      }),
    );
    this.gold.textContent = `${run.gold} G`;
    const status = el('p', this.status);
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    body.append(status);
    if (ruins && !path) {
      this.renderRuinsChoice(body, run, nodeId);
      this.renderTools(body);
      body.scrollTop = scroll;
      return;
    }
    if (ruins) body.append(el('p', chosenLine(path), 'ruins-chosen'));
    if (ruins && path === 'scavenge') {
      body.append(button('Browse wares', () => this.browseWares()));
      this.renderTools(body);
      body.scrollTop = scroll;
      return;
    }
    body.append(
      button('Heal all · Free', () => {
        if (ruins) {
          this.finish(healAtRuins(run, nodeId));
          return;
        }
        for (const u of run.roster) {
          u.currentHP = u.stats.HP;
          settleAccessoryHpOwed(u);
        }
        this.finish({ ok: true, message: 'All units healed.' });
      }),
    );
    if (!ruins) this.renderKindle(body, run);
    const reviveBlock = (u) =>
      ruins ? ruinsReviveBlock(run, nodeId, u) : churchReviveBlock(run, u);
    body.append(el('h3', 'Revive fallen ally'));
    if (!run.fallenUnits.length) body.append(el('p', 'No fallen allies.'));
    for (const unit of run.fallenUnits) {
      const reason = reviveBlock(unit);
      const catchUp = revivalCatchUpPlan(unit, run.roster);
      const b = button(`${unit.name} · ${unit.className} · Revive ${getReviveCost(unit)} G`, () =>
        this.choose({
          title: `Revive ${unit.name}?`,
          choices: [unit],
          confirmation: true,
          label: (u) => u.name,
          describe: () =>
            `${getReviveCost(unit)} gold. Returns at level ${catchUp.targetLevel} with 1 HP.${catchUp.levels ? ` Gains ${catchUp.levels} missed levels toward the living roster average (promotion-adjusted, capped in this class). Each catch-up growth is reduced by 10 percentage points, minimum 0%; future growths are unchanged.` : ' No catch-up levels needed.'}${starterLine(unit, this.scene.gameData)} Use Heal all, then Roster to re-equip. ${unit._fallenItemsNotice || 'Transferred gear stays in the convoy.'}`,
          blocked: (u) => reviveBlock(u),
          apply: (u) => this.finish(ruins ? reviveAtRuins(run, nodeId, u) : reviveAtChurch(run, u)),
        }),
      );
      b.disabled = !!reason;
      body.append(withUnitFace(b, this.scene, this.scene.gameData, unit));
      const info = button(`${unit.name}'s details`, () => this.fallenDetails(unit));
      info.classList.add('church-fallen-details');
      body.append(info);
      if (reason) body.append(el('p', reason));
    }
    if (!ruins) {
      body.append(el('h3', `Promote · ${CHURCH_PROMOTE_COST} G`));
      const eligible = run.roster.filter(canPromote);
      if (!eligible.length)
        body.append(el('p', 'No units eligible yet. Base classes can promote from level 10.'));
      for (const unit of eligible) {
        const reason = churchPromotionBlock(run, unit, nodeId, this.scene.gameData);
        const b = button(`${unit.name} · ${unit.className} · Lv ${getDisplayLevel(unit)}`, () =>
          this.promote(unit, nodeId),
        );
        b.disabled = !!reason;
        body.append(withUnitFace(b, this.scene, this.scene.gameData, unit));
        if (reason) body.append(el('p', reason));
      }
    }
    this.renderTools(body);
    body.scrollTop = scroll;
  }
  renderTools(body) {
    const tools = el('div', null, 'shop-tools');
    tools.append(
      button('View map', () => this.scene._enterChurchMapView()),
      button('Roster', () => this.roster()),
    );
    body.append(tools);
  }
  // Before a path is chosen: the two paths, each behind a confirmation (the choice is final).
  renderRuinsChoice(body, run, nodeId) {
    body.append(el('p', 'Rest or scavenge. The ruins allow only one.', 'ruins-rule'));
    const markup = ruinsMarkupPct();
    const fallen = run.fallenUnits.length;
    const paths = [
      {
        path: 'rest',
        title: 'Rest here?',
        confirmLabel: 'Rest',
        describe: `Every unit is healed now, free.${fallen ? ` You can then revive the fallen for gold (${fallen} waiting).` : ''} The wares stay buried. This cannot be undone.`,
        // What each path gives and costs, a line each (shown on upright phones; the
        // button's description everywhere).
        effects: [
          'Heal every unit now · Free',
          fallen ? `Revive the fallen for gold · ${fallen} waiting` : 'No fallen allies to revive',
          'The wares stay buried',
        ],
      },
      {
        path: 'scavenge',
        title: 'Scavenge the ruins?',
        confirmLabel: 'Scavenge',
        describe: `Buy and sell from the ruins' stock at ${markup}% over village prices. No healing or revival here. This cannot be undone.`,
        effects: [
          `Buy and sell the ruins' stock · +${markup}% over village prices`,
          'No healing or revival here',
        ],
      },
    ];
    for (const option of paths) {
      const label = ruinsPathLabel(option.path);
      const b = button(label, () =>
        this.choose({
          title: option.title,
          choices: [option.path],
          confirmation: true,
          confirmLabel: option.confirmLabel,
          label: () => label,
          describe: () => option.describe,
          blocked: (p) => ruinsChoiceBlock(run, nodeId, p),
          apply: (p) => {
            const result = chooseRuinsPath(run, nodeId, p);
            if (!result.ok) return result;
            // Scavenge goes straight to the wares once the picker closes.
            if (p === 'scavenge') {
              this.afterChoose = () => this.browseWares();
              this.status = result.message + saveServiceRun(this.scene);
              return result;
            }
            return this.finish(result);
          },
        }),
      );
      b.classList.add('ruins-path');
      b.dataset.path = option.path;
      // The name stays the label; the effect lines are its description, not part of
      // the name (shown on upright phones only, shopMenu.css).
      b.setAttribute('aria-label', label);
      const effects = el('span', null, 'ruins-path-effects');
      effects.id = `ruins-path-${option.path}-effects`;
      effects.setAttribute('aria-hidden', 'true');
      for (const line of option.effects) effects.append(el('span', line, 'ruins-path-effect'));
      b.setAttribute('aria-describedby', effects.id);
      b.append(effects);
      body.append(b);
    }
  }
  browseWares() {
    const node = this.scene._churchNode;
    this.c.closeChurchOverlay();
    this.scene.handleShop(node, { ruins: true });
  }
  // The Eclipse: Kindle lifts shadow for gold, once per chapel.
  renderKindle(body, run) {
    const config = run.getEclipseConfig?.();
    if (!run.isEclipseActive?.() || !config) return;
    const price = kindlePrice(run.currentAct, config);
    if (price == null) return;
    const nodeId = this.scene._churchNode?.id;
    const amount = Math.max(0, Math.trunc(Number(config.kindleAmount) || 0));
    const shadow = run.eclipse.shadow;
    const phase = eclipsePhase(shadow, config).name;
    const head = el('div', null, 're-kindle-head');
    head.append(
      createEclipseSunCanvas((tag) => el(tag), {
        size: 28,
        shadow,
        cap: config.cap,
        phaseIndex: eclipsePhase(shadow, config).index,
        dpr: Math.min(3, globalThis.window?.devicePixelRatio || 1),
        seed: 'kindle',
      }),
      el('h3', `Kindle the sun · ${price} G`),
    );
    body.append(head);
    body.append(
      el(
        'p',
        `Lift ${amount} shadow from the Eclipse. Now ${phase} · ${shadow} shadow. Once per chapel.`,
      ),
    );
    const reason = churchKindleBlock(run, nodeId);
    const after = Math.max(0, shadow - amount);
    const lift = Math.min(amount, shadow);
    // A clear sun has nothing to lift: no "−0 shadow" on the (disabled) button.
    const label = lift > 0 ? `Kindle · −${lift} shadow · ${price} G` : `Kindle · ${price} G`;
    const b = button(label, () =>
      this.choose({
        title: 'Kindle the sun?',
        choices: [nodeId],
        confirmation: true,
        label: () => 'Kindle',
        describe: () =>
          `${price} gold. Shadow ${shadow} → ${after} (${eclipsePhase(after, config).name}). Nodes fall later this act; places already taken stay taken.`,
        blocked: () => churchKindleBlock(run, nodeId),
        apply: () => this.finish(kindleAtChurch(run, nodeId)),
      }),
    );
    b.classList.add('re-kindle');
    b.disabled = !!reason;
    body.append(b);
    if (reason) body.append(el('p', reason));
  }
  finish(result) {
    if (result.ok) {
      this.scene.registry.get('audio')?.playSFX('sfx_heal');
      this.render(result.message + saveServiceRun(this.scene));
      this.surface.focusContent();
    }
    return result;
  }
  // Promotion: the path chooser, then the rite over the church once the
  // promotion, the gold and the save are committed (a refresh mid-rite
  // keeps all three exactly once).
  promote(unit, nodeId) {
    if (this.child) return;
    const run = this.scene.runManager;
    const gameData = this.scene.gameData;
    const targets = resolvePromotionTargets(unit, gameData.classes, gameData.lords);
    let rite = null;
    this.surface.root.inert = true;
    this.child = new PromotionPathChooser({
      scene: this.scene,
      unit,
      targets,
      gameData,
      title: `Promote ${unit.name}`,
      closeLabel: 'Close',
      note: `${CHURCH_PROMOTE_COST} G · you have ${run.gold} G`,
      confirmLabel: (cls) => `Promote to ${cls.name} · ${CHURCH_PROMOTE_COST} G`,
      blocked: () => churchPromotionBlock(run, unit, nodeId, gameData),
      apply: (target) => {
        const content = promotionPathContent(unit, target, gameData);
        const before = projectUnit(unit);
        const result = promoteAtChurch(run, unit, nodeId, target, gameData);
        if (!result.ok) return result;
        this.scene._churchPromotionsThisVisit = run.getChurchPromotionCount(nodeId);
        this.status = result.message + saveServiceRun(this.scene);
        rite = { content, before };
        return result;
      },
      onClose: (cls) => {
        this.child = null;
        const finish = () => {
          if (!this.surface || this.destroyed) return;
          this.surface.root.inert = false;
          this.render();
          this.surface.focusContent();
        };
        const growth = cls && rite ? growthCeremonies(this.scene) : null;
        if (!growth) {
          if (cls)
            void playCue(this.scene, 'promotion_crown', {
              fallbackSfx: 'sfx_levelup',
              waitMs: LEVEL_UP_CUE_WAIT_MS,
            });
          finish();
          return;
        }
        this.child = { destroy: () => {} };
        void growth
          .showPromotionRite({
            unit,
            content: rite.content,
            beforeUnit: rite.before,
            frame: 'screen',
          })
          .finally(() => {
            this.child = null;
            finish();
          });
      },
    });
  }
  choose(options) {
    if (this.child) return;
    this.afterChoose = null;
    this.surface.root.inert = true;
    this.child = new ChoicePicker({
      scene: this.scene,
      ...options,
      onClose: () => {
        this.child = null;
        const next = this.afterChoose;
        this.afterChoose = null;
        if (!this.surface || this.destroyed) return;
        this.surface.root.inert = false;
        if (next) return next();
        this.render();
        this.surface.focusContent();
      },
    });
  }
  /** Read-only unit sheet for a fallen ally, opened from the revive list. */
  fallenDetails(unit) {
    if (this.child) return;
    const fallen = this.scene.runManager.fallenUnits || [];
    this.surface.root.inert = true;
    this.child = new MobileRosterSheet({
      scene: this.scene,
      run: null,
      units: fallen,
      index: Math.max(0, fallen.indexOf(unit)),
      gameData: this.scene.gameData,
      onClose: () => {
        this.child.destroy();
        this.child = null;
        if (!this.surface || this.destroyed) return;
        this.surface.root.inert = false;
        this.surface.focusContent();
      },
    });
  }
  roster() {
    if (this.child) return;
    this.surface.root.inert = true;
    this.child = new MobileRosterSheet({
      scene: this.scene,
      run: this.scene.runManager,
      units: this.scene.runManager.roster,
      gameData: this.scene.gameData,
      onClose: () => {
        this.child.destroy();
        this.child = null;
        if (!this.surface || this.destroyed) return;
        this.surface.root.inert = false;
        this.render(this.status + saveServiceRun(this.scene));
        this.surface.focusContent();
      },
    });
  }
  setVisible(visible) {
    if (visible) this.open();
    else {
      this.child?.destroy();
      this.child = null;
      this.surface?.destroy();
      this.surface = null;
    }
  }
  destroy() {
    this.destroyed = true;
    this.setVisible(false);
  }
}
