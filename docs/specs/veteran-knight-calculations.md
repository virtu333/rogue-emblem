# Gaspar calculation appendix

Documentation-only executable analysis supporting [the veteran spec](veteran-knight.md).

Copy the code block below into `docs/specs/veteran-knight-calculations.mjs` in an engine checkout
at `f5f748f12b1e4e25150732f9974384f45a81a0d3`, then run:

```sh
node docs/specs/veteran-knight-calculations.mjs > /tmp/gaspar-calculations.json
```

This code constructs hypothetical units in memory. It does not change game data, saved runs,
or implement the character. The matching [results](veteran-knight-calculations-results.md)
include the sampling assumptions and limitations. Figures are not full-run balance certification.

```js
// Documentation-only balance analysis. Does not modify game data or implement Gaspar.
// Run from repo root: node docs/specs/veteran-knight-calculations.mjs > /tmp/gaspar.json
// Pin the checkout to the engineRef recorded below to reproduce the published report.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateBattle } from '../../src/engine/MapGenerator.js';
import { createEnemyUnit, createPromotedEnemyUnit, createLordUnit, calculateCombatXP } from '../../src/engine/UnitManager.js';
import { getCombatForecast, resolveCombat } from '../../src/engine/Combat.js';
import { getSkillCombatMods, rollStrikeSkills, rollDefenseSkills, checkAstra } from '../../src/engine/SkillSystem.js';
import { hitProbability } from '../../src/engine/HitRoll.js';
import { BOSS_STAT_BONUS } from '../../src/utils/constants.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = name => JSON.parse(fs.readFileSync(`${root}data/${name}.json`, 'utf8'));
const names = ['classes','weapons','skills','terrain','mapSizes','mapTemplates','enemies','recruits','difficulty','lords'];
const data = Object.fromEntries(names.map(name => [name, read(name)]));
const engineRef = 'f5f748f12b1e4e25150732f9974384f45a81a0d3';
const plain = data.terrain.find(t => t.name === 'Plain');
const forest = data.terrain.find(t => t.name === 'Forest');
const trials = 6000;
const weapon = name => structuredClone(data.weapons.find(w => w.name === name));
const clazz = name => data.classes.find(c => c.name === name);
const pct = n => Math.round(n * 1000) / 10;
const mean = a => a.reduce((x,y) => x+y, 0) / a.length;
function rng(seed) { let s = seed >>> 0; return () => { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s / 4294967296; }; }
function seeded(seed, fn) { const old = Math.random; Math.random = rng(seed); try { return fn(); } finally { Math.random = old; } }
const base = { HP:18, STR:10, MAG:0, SKL:12, SPD:10, DEF:6, RES:2, LCK:3, MOV:6 };
const statsByDifficulty = {
  normal: {...base}, dusk: {...base, HP:19}, hard: {...base, HP:20, DEF:7}, lunatic: {...base, HP:21, DEF:8},
};
function gaspar(stats = base, name = 'Steel Lance') {
  const w = weapon(name);
  return { name:'Gaspar', className:'Paladin', baseClass:'Cavalier', tier:'promoted', level:1,
    faction:'player', isLord:false, stats:{...stats}, currentHP:stats.HP, skills:['aegis'],
    growths:{HP:20, STR:10, MAG:0, SKL:15, SPD:10, DEF:5, RES:5, LCK:5},
    proficiencies:[{type:'Sword',rank:'Mast'},{type:'Lance',rank:'Mast'}], weaponRank:'Mast',
    inventory:[w], weapon:w, col:0, row:0, accessory:null, affixes:[], traits:[], classBattles:{} };
}
function enemy(name, level, difficulty, act = 'act1', boss = false) {
  const c = clazz(name), cfg = data.difficulty.modes[difficulty];
  const u = c.tier === 'promoted'
    ? createPromotedEnemyUnit(c, level, data.weapons, cfg, data.skills, act, data.classes)
    : createEnemyUnit(c, level, data.weapons, cfg, null, act);
  u.isBoss = boss;
  if (boss) {
    // Match BattleScene.addEnemyFromSpawn's boss adjustment, applied after creation.
    for (const stat of Object.keys(u.stats)) u.stats[stat] += BOSS_STAT_BONUS;
    u.currentHP = u.stats.HP;
  }
  // Isolate stat/weapon/class-innate effects; random learned enemy skills and affixes omitted.
  u.skills = boss && c.tier === 'promoted' ? u.skills.filter(s => ['aegis','canto'].includes(s)) : [];
  u.affixes = [];
  return u;
}
function context(a,b,at = plain,bt = plain,alliesA = [a],alliesB = [b]) {
  return { atkMods:getSkillCombatMods(a,b,alliesA,alliesB,data.skills,at,true,null,{weapon:a.weapon}),
    defMods:getSkillCombatMods(b,a,alliesB,alliesA,data.skills,bt,false,null,{weapon:b.weapon}),
    rollStrikeSkills, rollDefenseSkills, checkAstra, skillsData:data.skills };
}
function forecast(a,b,at=plain,bt=plain,alliesA=[a]) {
  const distance = a.weapon?.type === 'Bow' ? 2 : 1;
  return getCombatForecast(a,a.weapon,b,b.weapon,distance,at,bt,context(a,b,at,bt,alliesA));
}
function combat(a,b,at=plain,bt=plain,alliesA=[a]) {
  const distance = a.weapon?.type === 'Bow' ? 2 : 1;
  return resolveCombat(a,a.weapon,b,b.weapon,distance,at,bt,context(a,b,at,bt,alliesA));
}
const pools = {};
for (const difficulty of Object.keys(statsByDifficulty)) pools[difficulty] = seeded(0x473100, () => {
  const cfg = data.difficulty.modes[difficulty];
  const pool = [], composition = {};
  // The final Act 1 row is the boss node; measure that separately below.
  for (let row=0;row<7;row++) for(let map=0;map<85;map++) {
    const range = row===0 ? [1,1] : row===1 ? [1,2] : row===2 ? [1,3] : [2,3];
    const b = generateBattle({ ...cfg, act:'act1',row,deployCount:3,difficultyId:difficulty,
      levelRange:range, firstBattleFightersOnly:row===0, excludeOpeningCavaliers:false }, data);
    for(const s of b.enemySpawns.filter(s=>!s.isBoss)) {
      pool.push(enemy(s.className,s.level,difficulty));
      composition[s.className]=(composition[s.className]||0)+1;
    }
  }
  return {units:pool,composition};
});
function offense(pool, stats, name, aura=false, terrain=plain, seed=99100, mightOverride=null) {
  const potential=[], hpDamage=[], hits=[], crits=[], counterDamage=[];
  let kills=0, ownDeaths=0;
  const edric = createLordUnit(data.lords.find(l=>l.name==='Edric'),clazz('Lord'),data.weapons);
  edric.col=1;edric.row=0;
  for(let i=0;i<trials;i++) seeded(seed+i,()=> {
    const e=structuredClone(pool[i%pool.length]);
    const g=gaspar(stats,name),allies=aura?[g,edric]:[g];
    if(mightOverride!==null)g.weapon.might=mightOverride;
    const f=forecast(g,e,plain,terrain,allies);
    potential.push(f.attacker.damage*f.attacker.attackCount>=e.stats.HP?1:0);
    hpDamage.push(Math.min(1,f.attacker.damage*f.attacker.attackCount/e.stats.HP));
    hits.push(hitProbability(f.attacker.hit));crits.push(f.attacker.crit/100);
    counterDamage.push(f.defender.canCounter?f.defender.damage*f.defender.attackCount:0);
    const r=combat(g,e,plain,terrain,allies);
    if(r.defenderDied) kills++;
    if(r.attackerDied)ownDeaths++;
  });
  return {potentialORKOPct:pct(mean(potential)),actualKillPct:pct(kills/trials),
    meanCappedForecastDamagePct:pct(mean(hpDamage)),meanTrueHitPct:pct(mean(hits)),meanCritPct:pct(mean(crits)),
    meanCounterForecastDamage:Math.round(mean(counterDamage)*10)/10,ownDeathPct:pct(ownDeaths/trials)};
}
function survival(pool,stats,name,seed=88100) {
  const counts=[0,0,0,0];
  for(let i=0;i<trials;i++) seeded(seed+i,()=> {
    const g=gaspar(stats,name);
    for(let n=0;n<4;n++) {
      const e=structuredClone(pool[Math.floor(Math.random()*pool.length)]);
      const r=combat(e,g);g.currentHP=r.defenderHP;
      if(r.defenderDied)break;counts[n]++;
    }
  });
  return Object.fromEntries(counts.map((v,i)=>[`after${i+1}EnemyRoundsPct`,pct(v/trials)]));
}
const candidates={original22HP4DEF:{...base,HP:22,DEF:4,STR:11,SKL:7},
  control22HP4DEF:{...base,HP:22,DEF:4},
  revised20HP5DEF:{...base,HP:20,DEF:5},revised20HP6DEF:{...base,HP:20},
  recommended18HP6DEF:base,alternative19HP6DEF:{...base,HP:19},
  alternative18HP7DEF:{...base,HP:18,DEF:7},skill7:{...base,SKL:7},skill10:{...base,SKL:10}};
const candidateComparison=Object.fromEntries(Object.entries(candidates).map(([id,stats])=>[id,{stats,
  sword:offense(pools.normal.units,stats,'Iron Sword'),lance:offense(pools.normal.units,stats,'Steel Lance'),
  survivalSword:survival(pools.normal.units,stats,'Iron Sword'),survivalLance:survival(pools.normal.units,stats,'Steel Lance')} ]));
const difficultyComparison=Object.fromEntries(Object.entries(statsByDifficulty).map(([id,stats])=>[id,{stats,
  sampleUnits:pools[id].units.length,composition:pools[id].composition,
  sword:offense(pools[id].units,stats,'Iron Sword'),lance:offense(pools[id].units,stats,'Steel Lance'),
  survivalSword:survival(pools[id].units,stats,'Iron Sword'),survivalLance:survival(pools[id].units,stats,'Steel Lance')} ]));
const byClass=Object.fromEntries(Object.keys(pools.normal.composition).map(name=>[name,{
  sword:offense(pools.normal.units.filter(e=>e.className===name),base,'Iron Sword'),
  lance:offense(pools.normal.units.filter(e=>e.className===name),base,'Steel Lance')} ]));
const supportSensitivity={edricAuraSword:offense(pools.normal.units,base,'Iron Sword',true),
  edricAuraLance:offense(pools.normal.units,base,'Steel Lance',true),
  forestEnemySword:offense(pools.normal.units,base,'Iron Sword',false,forest),
  forestEnemyLance:offense(pools.normal.units,base,'Steel Lance',false,forest)};
supportSensitivity.tradedNerfedRapier=offense(pools.normal.units,base,'Rapier',false,plain,99100,6);
const feeding={};
for(const name of ['Iron Sword','Rapier 7','Rapier 6']) {
  let gasparKills=0,gasparDeaths=0,eligible=0,edricKills=0,combinedKills=0;
  for(let i=0;i<trials;i++)seeded(66300+i,()=> {
    const e=structuredClone(pools.normal.units[i%pools.normal.units.length]);
    const g=gaspar();const first=combat(g,e);
    if(first.defenderDied){gasparKills++;combinedKills++;return;}
    if(first.attackerDied){gasparDeaths++;return;}
    eligible++;e.currentHP=first.defenderHP;
    const ed=createLordUnit(data.lords.find(l=>l.name==='Edric'),clazz('Lord'),data.weapons);
    ed.weapon=weapon(name==='Iron Sword'?'Iron Sword':'Rapier');
    if(name==='Rapier 7')ed.weapon.might=7;
    if(name==='Rapier 6')ed.weapon.might=6;
    const second=combat(ed,e);
    if(second.defenderDied){edricKills++;combinedKills++;}
  });
  feeding[name]={gasparKillPct:pct(gasparKills/trials),gasparDeathPct:pct(gasparDeaths/trials),
    edricKillPctOfAllTargets:pct(edricKills/trials),edricKillPctOfSurvivingChippedTargets:pct(edricKills/eligible),
    combinedTwoActionsKillPct:pct(combinedKills/trials)};
}
const act2Falloff={};
for(const level of [3,5,6,8]) {
  const p=seeded(33400+level,()=>Array.from({length:600},(_,i)=>enemy(
    data.enemies.pools.act2.base.filter(n=>n!=='Cleric')[i%11],level,'normal','act2')));
  act2Falloff[level]={composition:'equal weight across 11 attacking Act 2 base classes; not map-weighted',
    sword:offense(p,base,'Iron Sword'),lance:offense(p,base,'Steel Lance'),
    survivalSword:survival(p,base,'Iron Sword'),survivalLance:survival(p,base,'Steel Lance')};
}
const bosses={};
for(const act of ['act1','act2'])for(const b of data.enemies.bosses[act]) {
  const p=seeded(22100,()=>Array.from({length:600},()=>enemy(b.className,b.level,'normal',act,true)));
  bosses[b.name]={level:b.level,className:b.className,
    sword:offense(p,base,'Iron Sword'),lance:offense(p,base,'Steel Lance'),
    survivalSword:survival(p,base,'Iron Sword'),survivalLance:survival(p,base,'Steel Lance')};
}
const rapier={};
for(const className of ['Fighter','Soldier','Cavalier','Knight']) {
  const e=seeded(5544,()=>enemy(className,1,'normal','act1'));
  rapier[className]={enemyHP:e.stats.HP};
  for(const might of [7,6]) {
    const ed=createLordUnit(data.lords.find(l=>l.name==='Edric'),clazz('Lord'),data.weapons);
    ed.growths={};ed.weapon=weapon('Rapier');ed.weapon.might=might;
    const f=forecast(ed,e);
    rapier[className][`might${might}`]={damagePerHit:f.attacker.damage,attackCount:f.attacker.attackCount,
      totalPotential:f.attacker.damage*f.attacker.attackCount,trueHitPct:pct(hitProbability(f.attacker.hit))};
    if(className==='Cavalier') { const g=gaspar();const gf=forecast(g,e);
      const hpAfterGaspar=e.stats.HP-gf.attacker.damage;
      rapier[className][`might${might}`].hpAfterOneGasparLanceHit=hpAfterGaspar;
      rapier[className][`might${might}`].oneRapierHitFinishes=hpAfterGaspar<=f.attacker.damage; }
  }
}
function growthExpected(growths) {
  const ps=Object.values(growths).map(v=>v/100),blank=ps.reduce((a,p)=>a*(1-p),1);
  const total=ps.reduce((a,p)=>a+p,0)+blank;
  const highest=Object.keys(growths).reduce((a,k)=>growths[k]>growths[a]?k:a,'HP');
  return {totalPointsPerLevel:total,blankRollProbability:blank,fallbackStat:highest,
    expectedByStat:Object.fromEntries(Object.entries(growths).map(([k,v])=>[k,v/100+(k===highest?blank:0)]))};
}
const growth={base:growthExpected(gaspar().growths),maxMeta:{}};
for(const [id,cfg] of Object.entries(data.difficulty.modes)) {
  const bonus=Math.round(25*cfg.growthBonusMultiplier*.5);
  growth.maxMeta[id]={perStatBonus:bonus,...growthExpected(Object.fromEntries(Object.entries(gaspar().growths).map(([k,v])=>[k,v+bonus])))};
}
const xp=Object.fromEntries([8,9,10,12].map(level=>[level,{kill:calculateCombatXP(gaspar(),{tier:'base',level},true),
  nonKill:calculateCombatXP(gaspar(),{tier:'base',level},false)}]));
console.log(JSON.stringify({engineRef,trials,seed:'LCG 1664525/1013904223; seeds in script',
  limitations:['No movement, Canto, healing, death catch-up, resource economy or full-run policy.',
    'Act 1: 595 generated rout maps/rung, 85 per non-boss row (0-6); first row Fighters only; three deployed; cavalry permitted.',
    'Offense: plain terrain unless noted; real 2RN, crits, counterattack ordering and Aegis.',
    'Survival: fresh full-HP random enemies initiate up to four rounds; bow uses range 2; Gaspar counters when legal; no healing.',
    'Enemy random learned skills, affixes, poison and status weapons omitted; do not treat as shipping gates.',
    'Act 2 falloff uses equal class weights and fixed enemy levels. Bosses use canonical promoted construction plus BOSS_STAT_BONUS; no throne/enrage/elite mods.',
    'Monte Carlo error around 50% is about +/-1.3 percentage points (95%) for 6000 independent trials; enemy population sampling adds uncertainty.'],
  candidateComparison,difficultyComparison,byClass,supportSensitivity,feeding,act2Falloff,bosses,rapier,growth,xp},null,2));
```

