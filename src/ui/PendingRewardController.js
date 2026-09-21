import { MobileRewards } from './MobileRewards.js';
import { LootScreenController } from './LootScreenController.js';
import { finishRewardClaim } from '../engine/PendingBattleRewards.js';
import { gainExperience, checkLevelUpSkills } from '../engine/UnitManager.js';
import { saveServiceRun } from './serviceSave.js';

// One native reward flow shared by battle completion and campaign re-entry.
export class PendingRewardController {
  constructor(scene, { onLeave, onComplete }) {
    this.host = scene;
    this.record = scene.runManager.pendingBattleReward;
    this.choices = this.record.choices;
    this.claimed = new Set(this.record.claimed);
    this.lootGroup = [];
    this.onLeave = onLeave;
    this.onComplete = onComplete;
    const view = Object.create(scene);
    Object.assign(view, {
      _lootCleanedUp: false,
      _lootResolving: false,
      _elitePicksRemaining: this.record.picksRemaining,
      _getLootTooltipText: (choice, item) =>
        LootScreenController.getTooltipText(scene, choice, item),
      finalizeLootPick: () => this.finish(),
      showPauseMenu: (options) => scene.showPauseMenu(options),
    });
    Object.defineProperty(view, 'pauseOverlay', { get: () => scene.pauseOverlay });
    this.scene = view;
    // The completion checkpoint may have failed; do not expose exit/navigation
    // until this reward record is durable. Retry writes the same rolled choices.
    this.persist();
    this.mobileRewards = new MobileRewards(
      view,
      this,
      this.choices,
      this.record.summary,
      this.record.skipGold,
    );
  }
  isRewardAvailable(index) {
    return (
      !this.saveError &&
      this.host.runManager.pendingBattleReward === this.record &&
      Number.isInteger(index) &&
      index >= 0 &&
      index <= this.choices.length &&
      !this.claimed.has(index)
    );
  }
  persist() {
    this.saveError = saveServiceRun(this.host);
    return !this.saveError;
  }
  applyNativeReward(index, command) {
    if (!this.isRewardAvailable(index)) return { ok: false, reason: 'Reward unavailable.' };
    const result = command();
    if (!result.ok) return result;
    finishRewardClaim(this.host.runManager, index);
    this.needsFinish = true;
    this.claimed.add(index);
    this.scene._elitePicksRemaining = this.record.picksRemaining;
    if (!this.persist()) return { ok: false, reason: this.saveError };
    return result;
  }
  activateReward(index) {
    const result = this.applyNativeReward(index, () => {
      const run = this.host.runManager,
        choice = this.choices[index];
      if (!choice) run.awardGold(this.record.skipGold);
      else if (choice.type === 'gold') {
        run.awardGold(choice.goldAmount || 0);
        for (const unit of run.roster)
          if (choice.xpAmount) {
            gainExperience(unit, choice.xpAmount, {
              extendedLevelingEnabled: run.getDifficultyModifier('extendedLevelingEnabled', false),
            });
            checkLevelUpSkills(unit, this.host.gameData.classes);
          }
      } else if (choice.type === 'accessory')
        (run.accessories ||= []).push(structuredClone(choice.item));
      else if (choice.item?.type === 'Scroll')
        (run.scrolls ||= []).push(structuredClone(choice.item));
      else return { ok: false, reason: 'Choose a recipient first.' };
      return { ok: true };
    });
    if (!result.ok) {
      this.mobileRewards.open();
      if (this.saveError) this.mobileRewards.renderSaveFailure();
      return;
    }
    this.finish();
  }
  finish() {
    if (this.saveError) return;
    this.needsFinish = false;
    this.mobileRewards.steps = [];
    if (!this.host.runManager.pendingBattleReward) {
      this.destroy();
      this.onComplete();
    } else {
      this.mobileRewards.open();
      this.mobileRewards.render();
    }
  }
  leave() {
    if (!this.persist()) {
      this.mobileRewards.renderSaveFailure();
      return;
    }
    this.destroy();
    this.onLeave();
  }
  retrySave() {
    if (!this.persist()) {
      this.mobileRewards.renderSaveFailure();
      return;
    }
    if (this.needsFinish) this.finish();
    else this.mobileRewards.render();
  }
  destroy() {
    this.mobileRewards?.destroy();
  }
  _teardownInputFocus() {
    this.destroy();
  }
}
