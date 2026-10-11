// PrologueDeployNote — a prologue chapter's deploy screen opens with its own field note
// (docs/specs/prologue-chapter.md §6 P4: "Your commander always deploys. Choose who
// fights", the axes swords beat and the Roster that equips before you deploy, and
// "Varro's axe reaches 1 tile: who can hit from 2?", and that Gaspar still fights: P2's
// lesson was about his kills). The chapter's deploy rule
// names the note (data/prologue.json `deploy.note`; copy in prologueContent). In the
// prologue run it shows once per slot (it marks the in-run deploy hint it stands in
// for); a replay shows it each time. Guidance Off shows none. The PrologueController, created once the battle
// begins, adds those hint ids to the lessons it records (`scene._prologueDeployTaught`).

import { prologueChapterOf, isStandaloneScriptedBattle } from '../engine/ScriptedBattle.js';
import { prologueDeployRule } from '../engine/Prologue.js';
import { NOTE_HINT_IDS, prologueNoteText } from '../data/prologueContent.js';
import { showImportantHint } from './HintDisplay.js';
import { guidanceLevelOf } from './guidanceGate.js';
import { prologueGuidanceAllows } from '../engine/Guidance.js';

/**
 * Show the deploy note for this battle's chapter, once. Resolves when read (null when
 * there is none to show).
 * @param {Phaser.Scene} scene - BattleScene at its deploy screen
 * @param {{ max?: number }} [limits] - the deploy screen's limits (its slot count)
 */
export function showPrologueDeployNote(scene, limits = {}) {
  const chapter = prologueChapterOf(scene?.battleParams, scene?.gameData);
  const rule = prologueDeployRule(chapter);
  if (!rule?.note || scene._prologueDeployNoteShown) return null;
  // Guidance Off: no field notes, this one included (nothing is marked read).
  if (!prologueGuidanceAllows(guidanceLevelOf(scene), 'note')) return null;
  const ids = NOTE_HINT_IDS[rule.note] || [];
  const inRun = !isStandaloneScriptedBattle(scene.battleParams, scene.runManager);
  const hints = scene.registry?.get?.('hints');
  if (inRun && ids.length && ids.every((id) => hints?.hasSeen?.(id))) return null;
  const boss = (chapter.enemies || []).find((e) => e?.isBoss);
  const veteran = (scene.runManager?.roster || []).find((u) => u?.specialCharId);
  const text = prologueNoteText(rule.note, {
    slots: Number(limits?.max) || chapter.playerSpawns?.length || null,
    boss: boss?.name || null,
    veteran: veteran?.name || null,
    touch: Boolean(scene.isMobileInput),
    // The run's deploy screen has its Roster button; a replay's does not.
    equip: Boolean(scene.runManager),
  });
  if (!text) return null;
  scene._prologueDeployNoteShown = true;
  scene._prologueDeployTaught = [...ids];
  if (inRun) for (const id of ids) hints?.markSeen?.(id);
  return showImportantHint(scene, text);
}
