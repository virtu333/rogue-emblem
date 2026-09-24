import { MenuSurface, element as el, button } from './MenuSurface.js';
import { canFight, getAvailableTiers } from '../engine/ColosseumEngine.js';
import { getDisplayLevel } from '../engine/UnitManager.js';
import { describeUnit } from './PartyMenus.js';

// Responsive presentation only. The controller remains responsible for rolling
// opponents, combat, rewards, hire costs, and per-visit limits.
export class ArenaMenu {
  constructor(controller, title, back) {
    this.c = controller;
    this.surface = new MenuSurface(controller.scene, title, () => {
      if (!this.surface?.destroyed) back();
    });
    this.surface.root.classList.add('service-menu');
    this.surface.header.querySelector('button').textContent = 'Back';
    this.surface.header.insertBefore(
      el('span', `${controller.runManager.gold} G`, 'shop-gold'),
      this.surface.header.lastChild,
    );
  }
  text(text) {
    this.surface.body.append(el('p', text));
  }
  action(label, action, reason = '') {
    const b = button(label, () => {
      if (!this.surface.destroyed) action();
    });
    b.disabled = !!reason;
    this.surface.body.append(b);
    if (reason) this.text(reason);
    return b;
  }
  focus() {
    const target =
      this.surface.root.querySelector('.service-footer button') ||
      this.surface.body.querySelector('button:not(:disabled)');
    (target || this.surface.root).focus({ preventScroll: true });
    this.surface.body.scrollTop = 0;
    return this;
  }
  destroy() {
    this.surface.destroy();
  }
  unit(unit) {
    this.surface.body.append(describeUnit(this.c.gameData, unit));
  }
  static menu(c) {
    const m = new ArenaMenu(c, 'Colosseum', () => c.leave());
    m.surface.header.querySelector('button').textContent = 'Leave';
    m.text(c._saveWarning || 'Fight results and hires save immediately.');
    m.text(
      'Train your fighters or hire a mercenary. Arena defeats leave your fighter with at least 1 HP.',
    );
    m.action('Arena', () => c._showUnitSelect());
    m.action('Mercenary board', () => c._showMercBrowse());
    return m.focus();
  }
  static units(c) {
    const m = new ArenaMenu(c, 'Arena · Choose fighter', () => c._showMenu());
    for (const u of c.runManager.roster) {
      const used = c._fightsPerUnit[u.name] || 0;
      m.action(
        `${u.name} · ${u.className} · Lv ${getDisplayLevel(u)} · HP ${u.currentHP}/${u.stats.HP} · Fights ${used}/${c._maxFights}`,
        () => {
          c._selectedUnit = u;
          c._showTierSelect();
        },
        canFight(u, used, c._maxFights)
          ? ''
          : `${u.name} cannot fight: check HP, weapon and visit limit.`,
      );
    }
    if (!c.runManager.roster.length) m.text('No fighters available.');
    return m.focus();
  }
  static tiers(c, message) {
    const m = new ArenaMenu(c, 'Arena · Choose tier', () => c._showUnitSelect());
    m.text(`${c._selectedUnit.name} · HP ${c._selectedUnit.currentHP}/${c._selectedUnit.stats.HP}`);
    if (message) m.text(message);
    for (const [name, tier] of getAvailableTiers(c._actId, c._colosseumData)) {
      m.action(
        `${name[0].toUpperCase() + name.slice(1)} · Win +${tier.goldReward} G · Loss −${tier.entryFee} G · XP ×${tier.xpMultiplier}`,
        () => {
          c._selectedTier = { name, ...tier };
          c._generateAndShowForecast();
        },
        c._canAffordTier(tier) ? '' : `Requires ${tier.entryFee} gold.`,
      );
    }
    return m.focus();
  }
  static forecast(c, forecast) {
    const m = new ArenaMenu(c, 'Arena · Combat forecast', () => c._showTierSelect());
    const grid = el('div', null, 'service-columns');
    for (const [u, f] of [
      [c._selectedUnit, forecast.attacker],
      [c._challenger.unit, forecast.defender],
    ]) {
      const card = el('article', null, 'service-card');
      card.append(
        el('h3', u.name),
        el('p', `${u.className} · Lv ${getDisplayLevel(u)} · HP ${u.currentHP}/${u.stats.HP}`),
        el('p', u.weapon?.name || 'Unarmed'),
        el(
          'p',
          `Damage ${f.damage}${f.doubles ? ' ×2' : ''} · Hit rating ${f.hit} · Crit ${f.crit}%`,
        ),
      );
      grid.append(card);
    }
    m.surface.body.append(grid);
    m.text(
      `One combat exchange: if both fighters survive, it is a draw. Wins earn full XP; draws earn 25% of normal combat XP (before the tier modifier). A loss costs ${c._selectedTier.entryFee} gold; a draw costs no gold. Your fighter keeps any HP lost, but cannot fall below 1 HP.`,
    );
    m.action('Fight', () => c._executeFight());
    return m.focus();
  }
  static log(c, lines, outcome, tier) {
    const next = () => c._showResult(outcome, tier);
    const m = new ArenaMenu(c, 'Arena · Combat result', next);
    m.surface.header.querySelector('button').textContent = 'Continue';
    for (const line of lines) if (line.text) m.text(line.text);
    m.action('Continue', next);
    return m.focus();
  }
  static result(c, outcome, tier, reward, levelUpInfo) {
    const m = new ArenaMenu(c, 'Arena · Rewards', () => c._showMenu());
    m.text({ win: 'Victory!', lose: 'Defeat', draw: 'Draw — no fee.' }[outcome]);
    const u = c._selectedUnit;
    m.text(`${u.name} · HP ${u.currentHP}/${u.stats.HP}`);
    m.text(c._saveWarning || 'Fight results and hires save immediately.');
    m.text(`Gold ${reward.goldDelta >= 0 ? '+' : ''}${reward.goldDelta} · XP +${reward.xpGained}`);
    if (levelUpInfo) {
      m.text(`Level ${levelUpInfo.from} → ${levelUpInfo.to}`);
      const learned = (levelUpInfo.learnedSkills || []).map(
        (id) => c.gameData.skills?.find((s) => s.id === id)?.name || id,
      );
      if (learned.length) m.text(`Learned: ${learned.join(', ')}`);
      for (const lu of levelUpInfo.ups || [])
        m.text(
          Object.entries(lu.gains || {})
            .filter(([, v]) => v > 0)
            .map(([s, v]) => `${s} +${v}`)
            .join(' · '),
        );
    }
    if (
      (c._levelsGainedThisVisit[u.name] || 0) >=
      (c._colosseumData?.arena?.diminishingReturnsAfterLevels ?? 2)
    )
      m.text('XP diminishing returns active.');
    if (canFight(u, c._fightsPerUnit[u.name] || 0, c._maxFights) && c._canAffordTier(tier))
      m.action('Fight again', () => c._generateAndShowForecast());
    m.action('Back to colosseum', () => c._showMenu());
    return m.focus();
  }
  static mercs(c) {
    const m = new ArenaMenu(c, 'Mercenary board', () => c._showMenu());
    m.text('Hire one mercenary per visit. Select a candidate to review their full details.');
    c._mercCandidates.forEach(({ unit: u, hireCost }, i) =>
      m.action(
        `${u.name} · ${u.className} · Lv ${getDisplayLevel(u)} · ${hireCost} G${u._hired ? ' · Hired' : ''}`,
        () => c._showMercConfirm(i),
      ),
    );
    if (!c._mercCandidates.length)
      m.text(
        c._mercGenerationFailed ? 'Mercenary board unavailable.' : 'No mercenaries available.',
      );
    return m.focus();
  }
  static hire(c, index) {
    const { unit: u, hireCost } = c._mercCandidates[index];
    const m = new ArenaMenu(c, `Hire ${u.name}`, () => c._showMercBrowse());
    m.unit(u);
    m.text(`Hire cost: ${hireCost} G · Gold after hire ${c.runManager.gold - hireCost} G`);
    const reason = u._hired
      ? 'Already hired.'
      : c._mercHired
        ? 'One hire per visit.'
        : c.runManager.roster.length >= c._getRosterCap()
          ? 'Roster full.'
          : c.runManager.gold < hireCost
            ? 'Not enough gold.'
            : '';
    const confirm = m.action('Confirm hire', () => c._hireMercenary(index), reason);
    const footer = el('footer', null, 'service-footer');
    footer.append(confirm);
    m.surface.root.append(footer);
    return m.focus();
  }
}
