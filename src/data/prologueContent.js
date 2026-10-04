// prologueContent — every line the prologue's coach, field notes and nudges say
// (docs/specs/prologue-chapter.md §6, P1's table). Pure: no DOM, no Phaser.
//
// Beats in data/prologue.json name copy by id (`coach: <id>`, `note: <id>`); spoken
// lines (`dialogue: <key>`) live in data/dialogue.json under `prologue`. Each entry is a
// function of a plain context so touch and desktop read differently ("Tap" / "Click"):
//   ctx.touch        phrase for taps instead of clicks
//   ctx.lord         the commander's name (Edric)
//   ctx.terrain      { name, defBonus, avoidBonus } the unit just arrived on (notes)
//   ctx.consumable   the consumable the note talks about ({ name, effect, value })

const tap = (ctx) => (ctx?.touch ? 'Tap' : 'Click');
const lordOf = (ctx) => ctx?.lord || 'Edric';
const danger = (ctx) => (ctx?.touch ? 'Danger' : 'Danger [D]');

/**
 * Coach goals: the one objective line over the map while a guided step is live.
 * @returns {{ goal: string, detail: string, chapter: string, anchor: object|null, canSkip: boolean }}
 */
export const PROLOGUE_COACH = Object.freeze({
  p1_select_edric: (ctx) => ({
    chapter: 'select',
    goal: `Select ${lordOf(ctx)}`,
    detail: `Blue units are yours; red are the empire's. ${tap(ctx)} ${lordOf(ctx)} to see where he can move.`,
    anchor: { kind: 'unit', name: lordOf(ctx) },
    canSkip: true,
  }),
  p1_move_to_fort: (ctx) => ({
    chapter: 'move',
    goal: 'Move onto the Fort',
    detail: `Blue tiles show his reach. ${tap(ctx)} the gold-framed Fort: cover lowers the damage he takes and raises his avoid.`,
    anchor: { kind: 'tile', ...(ctx?.gateTile || {}) },
    canSkip: true,
  }),
  // P3, The Seer on the Road (§6 P3): goals name an aim, never a tile.
  p3_reach_sera: (ctx) => ({
    chapter: 'move',
    goal: `Reach ${ctx?.npc || 'Sera'} and Talk`,
    detail: `Move ${lordOf(ctx)} next to the green unit, then choose Talk. Only a lord can.`,
    anchor: { kind: 'unit', name: lordOf(ctx) },
    canSkip: true,
  }),
  p3_sera_acts: (ctx) => ({
    chapter: 'fight',
    goal: `${ctx?.npc || 'Sera'} acts right away`,
    detail: `A unit that joins by Talk can move this turn. Keep ${ctx?.npc || 'Sera'} where the red can't reach.`,
    anchor: { kind: 'unit', name: ctx?.npc || 'Sera' },
    canSkip: true,
  }),
  p3_look_is_free: (ctx) => ({
    chapter: 'fight',
    goal: 'Open the forecast, then Cancel',
    detail: `Looking is free: nothing happens until you confirm. ${ctx?.touch ? 'Back' : 'Esc or right-click'} cancels.`,
    anchor: null,
    canSkip: true,
  }),
  // P4, The Quarry Gate (§6 P4): prompts fade, so the coach names only the objective.
  p4_objective: (ctx) => ({
    chapter: 'seize',
    goal: `Defeat ${ctx?.boss || 'Varro'}, then Seize the gate`,
    detail: `${ctx?.boss || 'Varro'} holds the throne at the gate. When he falls, a lord steps onto it and chooses Seize.`,
    anchor: null,
    canSkip: true,
  }),
  p4_seize: (ctx) => ({
    chapter: 'seize',
    goal: 'A lord: step onto the gate and Seize',
    detail: `${lordOf(ctx)} or another lord moves onto the throne, then chooses Seize.`,
    anchor: null,
    canSkip: true,
  }),
});

/**
 * Note copy by id: a beat's blocking `note` (modal, Continue to dismiss: the chapter's
 * core lessons) or non-blocking `tip` (reinforcement: docked beside the map, or one
 * line in an open forecast's notes; on the enemy phase a coach nudge). Tips read as
 * one paragraph (PrologueTip.tipText); a forecast tip is kept short, one line.
 */
export const PROLOGUE_NOTES = Object.freeze({
  battle_terrain: (ctx) => {
    const t = ctx?.terrain;
    const name = t?.name || 'Fort';
    const bonuses = t
      ? ` — Defense +${Number(t.defBonus) || 0}, Avoid +${Number(t.avoidBonus) || 0}.`
      : '.';
    const how = ctx?.touch ? 'tap' : 'point at';
    return (
      `${name} tile reached${bonuses}\n` +
      `The terrain preview shows the bonuses of any tile you ${how}. Fight from cover to take less damage and dodge more.`
    );
  },
  battle_forecast: () =>
    'Reading a forecast: damage per hit, the Hit chance, and whether the enemy strikes back.\n' +
    'Confirm commits the attack. Cancel goes back to planning, and looking costs nothing.',
  p1_wait_or_end_turn: (ctx) =>
    `Wait ends ${lordOf(ctx)}'s move. Once every unit has acted, the turn passes and each red unit gets its move.\n` +
    `Check who can reach you first: ${danger(ctx)} shows every tile an enemy can strike. The near Fighter reaches the Fort; the far one does not.`,
  p1_enemy_phase: (ctx) => `Red units move now. ${lordOf(ctx)} strikes back when attacked, too.`,
  p1_level_up: () => 'Levels raise stats at random. Growth rates decide the odds.',
  p1_holding_enemy: (ctx) =>
    `Some enemies hold their post until you come close. Their red reach shows where.\n${lordOf(ctx)} is inside it now, so this Fighter will come.`,
  // A forecast tip (P1, against the second Fighter): one line in the forecast's notes.
  battle_triangle: () =>
    'Swords beat axes, axes beat lances, lances beat swords. These numbers include it.',
  battle_consumable_supply: (ctx) => {
    const item = ctx?.consumable;
    const name = item?.name || 'Vulnerary';
    const effect =
      item?.effect === 'heal' && Number.isFinite(Number(item.value))
        ? `heals ${Number(item.value)} HP`
        : 'heals';
    return `Item → ${name} ${effect}.\nYou carry few, and they never come back: a consumable's uses are spent for good.`;
  },
  // P2, Old Hands (docs/specs/prologue-chapter.md §6 P2).
  p2_veteran_kills: (ctx) => {
    const name = ctx?.veteran || 'Gaspar';
    return (
      `${name} is strong now but barely grows and earns little XP.\n` +
      `Weaken enemies with ${name}, then leave the final blow to ${lordOf(ctx)} and your recruits: they grow from it.`
    );
  },
  battle_doubling: () =>
    'Weapon choice: the lance reads ×1, the sword ×2.\nAttack speed decides a second strike, and heavy weapons slow you. Switch weapons on the forecast and watch the ×2. A chip leaves the kill to someone who grows from it.',
  // A forecast tip (Edric against the Soldier): one line in the forecast's notes.
  p2_lances_beat_swords: (ctx) =>
    `Lances beat swords. Let ${ctx?.veteran || 'Gaspar'} open the Soldier; ${lordOf(ctx)} finishes it.`,
  battle_danger_zone: (ctx) =>
    `${danger(ctx)} shows every tile an enemy can strike next phase.\nCheck it before you end a unit's move, not after. Holding enemies count too: they wake when you step into their reach.`,
  p2_village_visit: () =>
    "A village: end a unit's action on it to visit.\nVillages give gold, and send an item to the convoy, your army's shared storage.",
  // P3, The Seer on the Road (§6 P3). The recruit and fragile notes reuse the in-run
  // Guidance copy (guide_recruit_on_map, guide_fragile_in_reach, guide_healer_heals).
  p3_recruit: (ctx) =>
    `${ctx?.npc || 'Sera'} (${ctx?.npcClass || 'Light Sage'}) under the gold banner can join you. Move a Lord next to her and choose Talk before enemies reach her.\n` +
    `Only the Soldier beside her can reach her this turn. Lords alone can Talk.`,
  p3_heal: (ctx) =>
    `${ctx?.npc || 'Sera'} heals with her staff: move next to ${ctx?.ally || 'a hurt ally'}, choose Heal.\n` +
    'Staff uses refill after every battle; a Vulnerary is spent for good.',
  p3_plan_cancel: (ctx) =>
    `Nothing is in reach from here, so Attack is greyed out.\n${ctx?.touch ? 'Back' : 'Esc or right-click'} undoes the move: nothing is final until you confirm. Try a tile 2 away from a foe.`,
  p3_range: () =>
    "Glimmer reaches 2 tiles. From 2 tiles away, a lance or an axe can't hit back.\nThe forecast shows No counter. Open it, then Cancel: looking is free.",
  p3_fragile: (ctx) => {
    const n = Number(ctx?.count) || 0;
    const who = ctx?.unit || 'Sera';
    return (
      `Cover isn't safety. ${n} ${n === 1 ? 'enemy' : 'enemies'} can reach ${who} here, and ${who} can't take many hits.\n` +
      `Count the red eyes, not the trees. ${ctx?.touch ? 'Tap Back' : 'Press Esc or right-click'} to choose a safer tile.`
    );
  },
  p3_aura: (ctx) =>
    `Renewal Aura: allies next to ${ctx?.npc || 'Sera'} heal 3 HP at the start of your turn.`,
  p3_rewind: (ctx) =>
    `${ctx?.ally || 'An ally'} is hurt. Sera grants one Vision.\n` +
    `Rewind takes back moves. Browse the timeline for free: find the move that put ${ctx?.ally || 'them'} in reach, spend the charge to return there, then choose a different tile. Declining is fine: the charge keeps.`,
  p3_better_plan: () =>
    'Same turn, better plan.\nIn a real run, Vision charges last the whole run: spend them on the turn that went wrong.',
  // P4, The Quarry Gate (§6 P4): only its own new rules (deploy, seize, par, the throne).
  // `equip`: the deploy screen has its Roster button (the run; a replay has none). The
  // last line keeps P2's veteran lesson where it is first acted on: it was about kills,
  // never about leaving him out.
  p4_deploy: (ctx) =>
    `Your commander always deploys. Choose who fights: ${Number(ctx?.slots) || 3} slots.\n` +
    `${ctx?.boss || 'Varro'} and his men carry axes, and swords beat axes${ctx?.equip ? ': Roster equips before you deploy' : ''}.\n` +
    `${ctx?.boss || 'Varro'}'s axe reaches 1 tile: who can hit from 2?\n` +
    `${ctx?.veteran || 'Gaspar'} still fights well: let him weaken foes, and let the others finish them.`,
  p4_seize_par: (ctx) =>
    `Seize: defeat ${ctx?.boss || 'Varro'}, then a lord steps onto the gate and chooses Seize.\n` +
    (Number.isFinite(ctx?.par)
      ? `Par: win in ${ctx.par} turns or fewer for bonus gold. Safety first; speed pays.`
      : 'Par is the target turn count: faster wins pay bonus gold. Safety first; speed pays.'),
  // A forecast tip (the first forecast against Varro on the throne).
  p4_throne: (ctx) =>
    `The throne guards ${ctx?.boss || 'Varro'}: harder to hurt, and he heals. Strike from 2.`,
  p4_seize_now: (ctx) =>
    `${ctx?.boss || 'Varro'} has fallen. Now a lord: step onto the gate and Seize.`,
});

/** Extra buttons a note offers besides Continue (PrologueController.fieldNote). */
export const PROLOGUE_NOTE_ACTIONS = Object.freeze({
  p3_rewind: [{ label: 'Open Rewind', value: 'rewind' }],
});

/**
 * Which in-run field notes a prologue note or tip stands in for (HintManager ids). Only
 * a read one marks them (a note acknowledged, a tip read or dismissed, a forecast tip
 * confirmed or cancelled), so a new slot skips only the first-use explanations the
 * player actually saw (prologueLessons.applyCompletedTutorialHints). What the prologue
 * no longer says (P2's no-counter, chances and loot notes, P3's magic) is not here:
 * Act 1 teaches it at its point of use (the forecast's inline notes, the loot screen).
 */
export const NOTE_HINT_IDS = Object.freeze({
  battle_terrain: ['battle_terrain'],
  battle_forecast: ['battle_forecast'],
  battle_triangle: ['battle_triangle'],
  battle_consumable_supply: ['battle_consumable_supply'],
  p1_wait_or_end_turn: ['battle_danger_zone'],
  p2_veteran_kills: ['guide_veteran_kills'],
  battle_doubling: ['battle_doubling'],
  battle_danger_zone: ['battle_danger_zone'],
  p2_village_visit: ['battle_village'],
  p3_recruit: ['guide_recruit_on_map'],
  p3_heal: ['guide_healer_heals'],
  p3_plan_cancel: ['guide_no_attack'],
  p3_range: ['battle_no_counter'],
  p3_fragile: ['guide_fragile_in_reach'],
  p4_deploy: ['battle_deploy'],
  p4_seize_par: ['battle_seize', 'battle_par'],
  p4_seize_now: ['guide_objective_changed'],
});

// --- Row 2: Harrow's Crossing (§6 "Route map, row 2") ----------------------------

/** The route map's note at the prologue's first fork (once per slot). */
export const PROLOGUE_FORK_NOTE =
  "Tap a node to see what it holds. Travel commits; you can't come back.";

/** P4's formation lesson: the line the placement panel adds (FormationController). */
export const PROLOGUE_FORMATION_LINE =
  'Tap a start tile to move a unit there. Who stands in front takes the first blow.';

/** A service node's opening line in the prologue (the shop / church / ruins status). */
export const PROLOGUE_SERVICE_LINES = Object.freeze({
  shop: "This market's stock is fixed while you're here. Every shop node stocks its own. Gold also pays for revivals and promotions.",
  church:
    'Heal all is free here. Reviving the fallen costs gold. Blessings begin with your first run.',
  ruins:
    "The watchtower's stores are old but sound. Rest heals everyone now; Scavenge sells what is left. Only one.",
  ruinsWares: 'Old stores, marked up: ruins charge more than a market does.',
});

/** Why the chapel's blessings are greyed in the prologue (ChurchVow.churchBlessingBlock). */
export const PROLOGUE_BLESSING_BLOCK = 'Blessings begin with your first run.';

/**
 * Travelling on from the fork with Tamsin unarmed (engine/PrologueDeparture): a
 * choice, never a gate (ui/PrologueDepartureWarning).
 */
export const PROLOGUE_UNARMED_DEPARTURE = Object.freeze({
  body: (name = 'Tamsin') =>
    `${name} has no usable weapon.\nShe can't attack in the next battle until she carries one.`,
  roster: 'Open Roster',
  go: 'Continue anyway',
});

/** An unarmed unit's roster line when the convoy holds a weapon it can use. */
export function unarmedConvoyLine(weaponType) {
  const kind = String(weaponType || 'weapon').toLowerCase();
  return `No weapon. A ${kind} is in the convoy.`;
}

/**
 * The roster lesson's steps (engine/PrologueRosterLesson.js), one goal each. ctx:
 * { subject, unit, giver, item, touch, available, reason }.
 */
export const PROLOGUE_ROSTER_LESSON = Object.freeze({
  withdraw: (ctx) => ({
    title: 'Withdraw',
    goal: `Give ${ctx?.subject || 'Tamsin'} the ${ctx?.item || 'bow'} from the convoy`,
    text: `Select ${ctx?.subject || 'Tamsin'}, open Convoy, and Withdraw.`,
  }),
  equip: (ctx) => ({
    title: 'Equip',
    goal: ctx?.unit ? `Equip ${ctx.unit}'s ${ctx.item}` : 'Equip a weapon',
    text: `${ctx?.subject || 'Tamsin'} took the bow at once: a unit with nothing equipped takes the first weapon it gets. Each unit carries up to 5 weapons. The equipped one is the one they fight with.`,
  }),
  trade: (ctx) => ({
    title: 'Trade',
    goal: ctx?.giver
      ? `Give ${ctx.subject || 'Tamsin'} ${ctx.giver}'s ${ctx.item}`
      : `Trade an item to ${ctx?.subject || 'Tamsin'}`,
    text: 'Trade swaps carried items between units. You can also trade in battle, with an adjacent ally.',
  }),
  store: (ctx) => ({
    title: 'Store',
    goal: ctx?.unit ? `Store ${ctx.unit}'s ${ctx.item}` : 'Store a carried item',
    text: 'Store puts a carried item in the convoy. Withdraw hands it back.',
  }),
});

/**
 * The roster lesson's optional part (after Withdraw and Equip): Trade and Store,
 * offered as more, never as steps the lesson waits on. `steps` are those still open.
 */
export const PROLOGUE_ROSTER_LESSON_MORE = Object.freeze({
  coreDone: 'done',
  kicker: 'More',
  goal: (steps = ['trade', 'store']) =>
    `More, if you like: ${steps.map((s) => (s === 'trade' ? 'Trade' : 'Store')).join(' and ')}`,
  text: (steps = ['trade', 'store']) =>
    [
      steps.includes('trade') ? 'Trade swaps carried items between units.' : '',
      steps.includes('store') ? 'Store puts an item in the convoy.' : '',
      'Optional: the road waits either way.',
    ]
      .filter(Boolean)
      .join(' '),
  accept: 'Show me',
  decline: 'Done',
  stop: 'Done',
  declined: 'Roster lesson complete.',
});

/** Why a step was skipped on its own (the army can't do it now). */
export const PROLOGUE_ROSTER_LESSON_SKIPS = Object.freeze({
  no_weapon_in_convoy: (ctx) =>
    `No weapon ${ctx?.subject || 'she'} can use is in the convoy. A shop sells one.`,
  bag_full: (ctx) => `${ctx?.subject || 'Her'} bag is full.`,
  no_spare_weapon: () => 'Nobody carries a second weapon to equip.',
  no_spare_consumable: () =>
    'Nobody carries a spare item to trade. You can trade in battle with an adjacent ally, too.',
  nothing_to_store: () => 'Nothing to store right now.',
});

export function rosterLessonCopy(step, ctx) {
  const build = PROLOGUE_ROSTER_LESSON[step];
  return build ? build(ctx) : null;
}

export function rosterLessonSkipText(reason, ctx) {
  const build = PROLOGUE_ROSTER_LESSON_SKIPS[reason];
  return build ? build(ctx) : '';
}

/**
 * The ending's break (CeremonyController.showRunEnd's card over its last scene). Not a
 * run's defeat: the player held the gate, and the world broke for its own reasons (the
 * ritual in the east). So never the game-over words: THE THREAD BREAKS, the gate held,
 * and (after the last chapter's win) the prologue complete. After a skip it says only
 * that the world broke.
 */
export function prologueThreadCard({ won = false } = {}) {
  return {
    tone: 'cut',
    word: 'THE THREAD BREAKS',
    sub: won ? 'The gate held. The world did not.' : 'The world did not hold',
    meta: won ? 'Prologue complete · Sera weaves again' : 'Prologue · Sera weaves again',
  };
}

/** PROLOGUE COMPLETE: the win, said before the world breaks (the ending's `card`). */
export function prologueCompleteCard({ chapters = 0 } = {}) {
  const n = Math.max(0, Math.trunc(Number(chapters) || 0));
  return {
    tone: 'holds',
    word: 'PROLOGUE COMPLETE',
    sub: 'The Quarry Gate is held',
    meta: n ? `${n} ${n === 1 ? 'chapter' : 'chapters'} won` : '',
  };
}

/**
 * The handoff (ui/PrologueHandoff): the one screen between the ending and Home Base,
 * where the tutorial's protection ends. Plain words, one rule a row: what ends a run,
 * what a fall costs, what starts over, what stays, how long Vision lasts. `lead` is
 * the ending's title card (data/prologue.json `ending.titleCard`).
 */
export function prologueHandoffContent({ lead = '', won = false, commander = 'Edric' } = {}) {
  const lord = commander || 'Edric';
  return {
    title: 'From here, it counts',
    kicker: won ? 'Prologue complete' : 'The prologue ends',
    lead: typeof lead === 'string' ? lead.trim() : '',
    rows: [
      {
        term: 'A run ends',
        text: `only when your commander falls. ${lord} leads your first run.`,
      },
      {
        term: 'Fallen allies',
        text: 'stay down until a Church revives them for gold.',
      },
      {
        term: 'Starts over',
        text: 'each run: a fresh army, with levels, items and gold reset.',
      },
      {
        term: 'Stays',
        text: 'Valor and Supply you earn, and the Home Base upgrades they buy.',
      },
      {
        term: 'Vision',
        text: 'charges last the whole run. Spend them on the turn that went wrong.',
      },
    ],
    action: 'To Home Base',
  };
}

export function prologueEndingCard(prologue) {
  const text = prologue?.ending?.titleCard;
  return typeof text === 'string' && text.trim() ? text.trim() : '';
}

/**
 * Begin Run on a slot whose prologue run save could not be read (state left
 * 'in_progress', PrologueRouting.routeForBeginRun → offer): restart it from P1 or skip
 * to the first run. Back (the Escape default) leaves Home Base as it was.
 */
export const PROLOGUE_LOST = Object.freeze({
  body: "The prologue's save could not be read. Play it again from the first chapter, or skip to your first run. The Home Base gift comes only with the prologue's end.",
  back: 'Back',
  restart: 'Restart the Prologue',
  skip: 'Skip to the first run',
});

/**
 * The offer a fresh slot gets on New Game (§4): play the prologue (the highlighted
 * default on a device that has not finished it) or skip to the first run.
 */
export const PROLOGUE_OFFER = Object.freeze({
  title: 'Begin the first thread?',
  body: "The prologue teaches the field in four short chapters, from Edric's first fight to the quarry gate. Skip it and your first run begins at once.",
  play: 'Play the Prologue',
  playSub: 'about 20 minutes',
  skip: 'Skip to the first run',
});

/** Home Base, first visit after the prologue: what the grant is for. */
export const PROLOGUE_HOME_BASE_NOTE =
  'This is what stays between runs. Spend the Valor and Supply from the first thread.';

/** The route-map note of a first run that followed the prologue (Home Base is known). */
export const PROLOGUE_FIRST_RUN_ROUTE_NOTE =
  'Your first run begins here, and now it counts: if Edric falls, the run ends. Tap a node to preview; Travel commits.';

/** Short corrections while a guided step is live (coach nudges). */
export const PROLOGUE_NUDGES = Object.freeze({
  gate_select: (ctx) => `Select ${lordOf(ctx)} first.`,
  gate_move: (ctx) => `Move ${lordOf(ctx)} to the gold-framed Fort.`,
  gate_step: () => 'Finish the guided step first.',
  gate_pause: () => 'You can leave once your turn is back.',
});

/** The victory handoff after a replayed chapter's last line (back to the title). */
export function prologueHandoff({ title = 'the prologue' } = {}) {
  return `Victory! ${title} is yours.\nYour saves are waiting on the title screen.`;
}

export function prologueCoachGoal(id, ctx) {
  const build = PROLOGUE_COACH[id];
  return build ? { id, ...build(ctx) } : null;
}

export function prologueNoteText(id, ctx) {
  const build = PROLOGUE_NOTES[id];
  return build ? build(ctx) : '';
}

export function prologueNudgeText(id, ctx) {
  const build = PROLOGUE_NUDGES[id];
  return build ? build(ctx) : '';
}
