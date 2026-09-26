import {RunManager} from '../../../src/engine/RunManager.js';
import {generateMercenaryCandidates} from '../../../src/engine/ColosseumEngine.js';
import {generateBattle} from '../../../src/engine/MapGenerator.js';
import {createSeededRng} from '../../../src/engine/BlessingEngine.js';
import {recordBattleRecruit,fallenBattleRecruits} from '../../../src/engine/BattleRecruits.js';
import {loadGameData} from '../../../tests/testData.js';
const data=loadGameData();
const withSeed=(seed,fn)=>{const prev=Math.random;Math.random=createSeededRng(seed);try{return fn(Math.random)}finally{Math.random=prev}};
function fresh(seed){const r=new RunManager(data);r.startRun({runSeed:seed,applyBlessingsAtStart:false});return r}
function mercs(names){return withSeed(10,rng=>generateMercenaryCandidates('act1',3,data.recruits,data.classes,data.weapons,data.skills,'normal',data.colosseum,rng,data.traits,names))}
const r=fresh(2);const n=r.nodeMap.nodes.find(n=>n.id==='act1_4_0');
const oldMercs=mercs(r.roster.map(u=>u.name));const newMercs=mercs([...r.getTakenUnitNames()]);
const m=oldMercs.find(c=>c.unit.name===n.recruitPreview.name).unit;
r.roster.push(m);r.ensureUnitUids();const npc=r.getRecruitNodeUnit(n).unit;r.assignUnitUid(npc);npc.faction='player';
const records=recordBattleRecruit([],npc);const survivors=r.getRoster();const fallen=fallenBattleRecruits(records,survivors,r.roster);
r.completeBattle(survivors,n.id,0,{fallenRecruits:fallen});
const summary={collision:{runSeed:2,mercRngSeed:10,promised:n.recruitPreview.name,oldCandidates:oldMercs.map(c=>c.unit.name),newCandidates:newMercs.map(c=>c.unit.name),oldMercUid:m.unitUid,npcUid:npc.unitUid,recordedFallen:r.fallenUnits.map(u=>({name:u.name,uid:u.unitUid}))}};
let count=0;const bad=[];let original;
for(let seed=1;seed<=200;seed++){
 const rm=fresh(seed);
 for(let act=0;act<4;act++){
  for(const node of rm.nodeMap.nodes.filter(n=>n.type==='recruit')){
   const built=rm.getRecruitNodeUnit(node).unit;const params=rm.getBattleParams(node);
   const bc=withSeed(seed*31+act,()=>generateBattle(params,data));if(!bc.npcSpawn)throw Error('missing NPC');
   const t=data.terrain[bc.mapLayout[bc.npcSpawn.row][bc.npcSpawn.col]];count++;
   const result={seed,act:rm.currentAct,node:node.id,actualName:built.name,actualClass:built.className,moveType:built.moveType,terrain:t.name,cost:t.moveCost[built.moveType],tile:{col:bc.npcSpawn.col,row:bc.npcSpawn.row}};
   if(result.cost==='--'||result.cost===undefined)bad.push(result);
   if(seed===54&&node.id==='act1_3_4')original=result;
  }
  rm.advanceAct();
 }
}
summary.terrain={original,generated:count,invalid:bad};console.log(JSON.stringify(summary,null,2));
if(newMercs.some(c=>c.unit.name===n.recruitPreview.name)||!r.fallenUnits.some(u=>u.unitUid===npc.unitUid)||bad.length)process.exitCode=1;
