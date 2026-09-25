import { revivalCatchUpPlan } from '../engine/RevivalCatchUp.js';
import { PromotionPathChooser } from './PromotionPathChooser.js';
import { promotionPathContent, projectUnit } from './growthContent.js';
import { growthCeremonies } from './GrowthCeremonyController.js';
import { MenuSurface, element as el, button } from './MenuSurface.js';
import { ChoicePicker } from './ChoicePicker.js';
import { MobileRosterSheet } from './MobileRosterSheet.js';
import { saveServiceRun } from './serviceSave.js';
import { canPromote, resolvePromotionTargets, getDisplayLevel } from '../engine/UnitManager.js';
import { getReviveCost } from '../engine/RunManager.js';
import {
  churchPromotionBlock,
  promoteAtChurch,
  churchReviveBlock,
  reviveAtChurch,
} from '../engine/ChurchCommands.js';
import { CHURCH_PROMOTE_COST } from '../utils/constants.js';
import { applyServiceVignette, prefersStill } from './itemMoments.js';
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
    body.append(
      applyServiceVignette(this.surface.root, ruins ? 'ruins' : 'church', {
        title: ruins ? 'Ruins sanctuary' : 'Church',
        kicker: ruins ? 'Heal · Revive · Wares' : 'Heal · Revive · Promote',
        still: prefersStill(this.scene),
        backdrop: true,
      }),
    );
    this.gold.textContent = `${run.gold} G`;
    const status = el('p', this.status);
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    body.append(status);
    body.append(
      button('Heal all · Free', () => {
        for (const u of run.roster) u.currentHP = u.stats.HP;
        this.finish({ ok: true, message: 'All units healed.' });
      }),
    );
    if (this.scene._churchRuinsMode)
      body.append(
        button('Browse wares', () => {
          const node = this.scene._churchNode;
          this.c.closeChurchOverlay();
          this.scene.handleShop(node, { ruins: true });
        }),
      );
    body.append(el('h3', 'Revive fallen ally'));
    if (!run.fallenUnits.length) body.append(el('p', 'No fallen allies.'));
    for (const unit of run.fallenUnits) {
      const reason = churchReviveBlock(run, unit);
      const catchUp = revivalCatchUpPlan(unit, run.roster);
      const b = button(`${unit.name} · ${unit.className} · Revive ${getReviveCost(unit)} G`, () =>
        this.choose({
          title: `Revive ${unit.name}?`,
          choices: [unit],
          confirmation: true,
          label: (u) => u.name,
          describe: () =>
            `${getReviveCost(unit)} gold. Returns at level ${catchUp.targetLevel} with 1 HP.${catchUp.levels ? ` Gains ${catchUp.levels} missed levels toward the living roster average (promotion-adjusted, capped in this class). Each catch-up growth is reduced by 10 percentage points, minimum 0%; future growths are unchanged.` : ' No catch-up levels needed.'} Use Heal all, then Roster to re-equip. ${unit._fallenItemsNotice || 'Transferred gear stays in the convoy.'}`,
          blocked: (u) => churchReviveBlock(run, u),
          apply: (u) => this.finish(reviveAtChurch(run, u)),
        }),
      );
      b.disabled = !!reason;
      body.append(b);
      if (reason) body.append(el('p', reason));
    }
    if (!this.scene._churchRuinsMode) {
      body.append(el('h3', `Promote · ${CHURCH_PROMOTE_COST} G`));
      const eligible = run.roster.filter(canPromote);
      if (!eligible.length)
        body.append(el('p', 'No units eligible yet. Base classes can promote from level 10.'));
      const nodeId = this.scene._churchNode.id;
      for (const unit of eligible) {
        const reason = churchPromotionBlock(run, unit, nodeId, this.scene.gameData);
        const b = button(`${unit.name} · ${unit.className} · Lv ${getDisplayLevel(unit)}`, () =>
          this.promote(unit, nodeId),
        );
        b.disabled = !!reason;
        body.append(b);
        if (reason) body.append(el('p', reason));
      }
    }
    const tools = el('div', null, 'shop-tools');
    tools.append(
      button('View map', () => this.scene._enterChurchMapView()),
      button('Roster', () => this.roster()),
    );
    body.append(tools);
    body.scrollTop = scroll;
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
          if (cls) this.scene.registry.get('audio')?.playSFX('sfx_levelup');
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
    this.surface.root.inert = true;
    this.child = new ChoicePicker({
      scene: this.scene,
      ...options,
      onClose: () => {
        this.child = null;
        if (!this.surface || this.destroyed) return;
        this.surface.root.inert = false;
        this.render();
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
