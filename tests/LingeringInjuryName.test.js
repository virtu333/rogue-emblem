// The `wounded` burden is called Lingering Injury wherever a player reads it, because "Wounded" is
// the status condition's name (no HP recovery except from a staff) and the two heal differently.
// The id `wounded` is save data and never changes; so does the condition's name.
//
// Ways this can fail, a test each:
//   1. the catalog's label or line still says Wounded (the chip, the pause list, the church's
//      Cleanse list, the Event page's result line and the victory band all read it);
//   2. a sentence built in code (church line, Heal all message, victory band, Cleanse refusal,
//      an event that cannot injure anyone) still says "wound" for the burden;
//   3. an event that applies the burden names it "Wounded" in its own text;
//   4. the rename leaks into the id or into the status condition.
import { describe, expect, it } from 'vitest';
import {
  describeBurdens,
  injuryPhrase,
  settlementLines,
  woundHealLine,
} from '../src/engine/Burdens.js';
import { healRosterAtChurch } from '../src/engine/ChurchCommands.js';
import { churchCleanseBlock } from '../src/engine/ChurchVow.js';
import { chooseEventOption } from '../src/engine/EventCommands.js';
import { describeResult } from '../src/engine/EventResultWords.js';
import { pauseBurdenEntries } from '../src/ui/eventMenuModel.js';
import { statusDescriptions } from '../src/engine/BattleInformation.js';
import { applyCondition } from '../src/engine/StatusConditionSystem.js';
import { addUnit, arriveAs, baseData, newRun, runWithEvents, soloEvent } from './eventKit.js';

const NAME = 'Lingering Injury';
const events = baseData.events;

/** Every string under a value, with its path (ids and keys excluded: they are not read). */
function strings(value, path = '', out = []) {
  if (typeof value === 'string') out.push([path, value]);
  else if (Array.isArray(value)) value.forEach((v, i) => strings(v, `${path}[${i}]`, out));
  else if (value && typeof value === 'object')
    for (const [k, v] of Object.entries(value)) {
      if (k === 'id' || k === 'type' || k === 'scope' || k === 'stat') continue;
      strings(v, `${path}.${k}`, out);
    }
  return out;
}

function carry(run, unit) {
  run.burdens = [
    {
      id: 'wounded',
      unitUid: unit.unitUid,
      unitName: unit.name,
      stat: 'STR',
      value: -2,
      battles: 2,
    },
  ];
}

describe('the burden is named Lingering Injury', () => {
  it('the catalog entry keeps id `wounded` and says no "wound" word in its player text', () => {
    const def = events.burdens.wounded;
    expect(def.label).toBe(NAME);
    expect(def.line).toMatch(/injury/i);
    for (const [, text] of strings(def)) expect(text).not.toMatch(/wound/i);
  });

  it('the chip and the pause list read the name, the stat and the battles left', () => {
    const run = newRun();
    const unit = addUnit(run, 'Fighter', { name: 'Hale' });
    carry(run, unit);
    const [chip] = describeBurdens(run);
    expect(chip).toMatchObject({ id: 'wounded', label: NAME, short: 'Hale −2 STR' });
    expect(chip.detail).toBe('Hale fights at −2 STR, 2 battles left; a church heal ends it');
    const [entry] = pauseBurdenEntries(run, run.gameData.events);
    expect(entry).toMatchObject({ id: 'wounded', label: NAME });
    for (const text of [chip.label, chip.short, chip.line, chip.detail, entry.label])
      expect(text).not.toMatch(/wound/i);
  });

  it("the church's line, Heal all's message and the victory band say lingering injury", () => {
    const run = newRun();
    const unit = addUnit(run, 'Fighter', { name: 'Hale' });
    carry(run, unit);
    expect(woundHealLine(run)).toBe("Heal all also mends Hale's lingering injury.");
    expect(settlementLines({ wounded: { name: 'Hale', ended: true } })).toEqual([
      "Hale's lingering injury mends",
    ]);
    expect(settlementLines({ wounded: { name: '', ended: true } })).toEqual([
      'The lingering injury mends',
    ]);
    expect(healRosterAtChurch(run).message).toBe(
      "All units healed. Hale's lingering injury mends.",
    );
    expect(injuryPhrase({ unitName: '' }, { capital: false })).toBe('the lingering injury');
  });

  it('a Cleanse refusal names the injury, not a wound', () => {
    const run = newRun();
    carry(run, addUnit(run, 'Fighter', { name: 'Hale' }));
    const church = run.nodeMap.nodes.find((n) => n.type === 'church');
    const reason = churchCleanseBlock(run, church.id, 'wounded');
    expect(reason).toBe('Heal all mends a lingering injury. It needs no vow.');
  });

  it("an event's result line names it, and its record is still id `wounded`", () => {
    const run = runWithEvents([
      soloEvent([{ type: 'burden', id: 'wounded', params: { scope: 'target', stat: 'DEF' } }], {
        choice: { target: { prompt: 'Who?' } },
      }),
    ]);
    const unit = addUnit(run, 'Fighter', { name: 'Bram' });
    const node = arriveAs(run, 'solo');
    const result = chooseEventOption(run, node.id, 'go', { targetUid: unit.unitUid });
    expect(result.ok, result.reason).toBe(true);
    expect(run.burdens[0].id).toBe('wounded');
    const line = describeResult(result.results[0], { gameData: run.gameData });
    expect(line.text).toBe(`Burden: ${NAME}`);
    expect(`${line.text} ${line.detail}`).not.toMatch(/wound/i);
  });

  it('no event that applies the burden calls it Wounded in its own text', () => {
    const applies = (value) => JSON.stringify(value).includes('"id":"wounded"');
    const carriers = events.events.filter(applies);
    expect(carriers.length).toBeGreaterThan(0);
    for (const event of carriers)
      for (const [path, text] of strings({ ...event, title: undefined }))
        expect(text, `${event.id}${path}`).not.toMatch(/\bwounded\b/i);
  });
});

describe('the status condition keeps its own name', () => {
  it('a Wounded unit is still described as Wounded: no HP except from a staff', () => {
    const run = newRun();
    const unit = addUnit(run, 'Fighter', { name: 'Hale' });
    applyCondition(unit, 'wounded', 2);
    const [line] = statusDescriptions(unit);
    expect(JSON.stringify(line)).toContain('Wounded');
    expect(JSON.stringify(line)).toContain('Recovers no HP except from a staff.');
  });
});
