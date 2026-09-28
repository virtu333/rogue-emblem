import { describe, expect, it } from 'vitest';
import { canUseWeaponArt } from '../src/engine/WeaponArtSystem.js';
import { applyImbue } from '../src/engine/ImbueSystem.js';
import { applyForge } from '../src/engine/ForgeSystem.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const arts = data.weaponArts.arts;
const imbues = data.imbues.imbues ?? data.imbues;
const weapon = (name) => structuredClone(data.weapons.find((w) => w.name === name));
const imbue = (id) => imbues.find((i) => i.id === id);
const art = (id) => arts.find((a) => a.id === id);
const master = (type) => ({
  faction: 'player',
  currentHP: 30,
  stats: { HP: 30 },
  proficiencies: [{ type, rank: 'Mast' }],
});
const reason = (w, a) => canUseWeaponArt(master(w.type), w, a).reason ?? 'ok';

describe('a legendary keeps its signature art after an imbue or a forge', () => {
  // The legendary gate compared decorated names ("Cruel Twinsworn +1") with the
  // catalog's ("Twinsworn"), so upgrading the weapon locked its art away.
  for (const [name, artId] of [
    ['Twinsworn', 'legend_gemini_tempest'],
    ['Namethief', 'legend_life_drain'],
    ['Gae Bolg', 'legend_blood_lance'],
  ]) {
    it(name, () => {
      const plain = reason(weapon(name), art(artId));
      expect(plain).toBe('ok');

      const imbued = weapon(name);
      expect(applyImbue(imbued, imbue('keen')).success).toBe(true);
      expect(imbued.name).toBe(`Cruel ${name}`);
      expect(reason(imbued, art(artId))).toBe(plain);

      const forged = weapon(name);
      applyForge(forged, 'might');
      expect(forged.name).toBe(`${name} +1`);
      expect(reason(forged, art(artId))).toBe(plain);

      applyImbue(forged, imbue('vampiric'));
      expect(forged.name).toBe(`Vampiric ${name} +1`);
      expect(reason(forged, art(artId))).toBe(plain);
    });
  }

  it('another weapon imbued or forged still does not unlock it', () => {
    const iron = weapon('Iron Sword');
    applyImbue(iron, imbue('keen'));
    applyForge(iron, 'might');
    expect(reason(iron, art('legend_gemini_tempest'))).toBe('legendary_weapon_required');
  });
});
