import {RunManager} from '../../../src/engine/RunManager.js';
import {generateMercenaryCandidates} from '../../../src/engine/ColosseumEngine.js';
import {createSeededRng} from '../../../src/engine/BlessingEngine.js';
import {recordBattleRecruit,fallenBattleRecruits} from '../../../src/engine/BattleRecruits.js';
import {loadGameData} from '../../../tests/testData.js';
const d=loadGameData(),r=new RunManager(d);r.startRun({runSeed:2,applyBlessingsAtStart:false});
const node=r.nodeMap.nodes.find(n=>n.id==='act1_4_0');
const prev=Math.random;Math.random=createSeededRng(10);
const merc=generateMercenaryCandidates('act1',3,d.recruits,d.classes,d.weapons,d.skills,'normal',d.colosseum,Math.random,d.traits,r.roster.map(u=>u.name)).find(c=>c.unit.name===node.recruitPreview.name).unit;Math.random=prev;
r.roster.push(merc);
// Save predates unitUid; Talk recruit exists only in checkpoint, as in build 89.
for(const unit of r.roster)delete unit.unitUid;
const npc=r.getRecruitNodeUnit(node).unit;npc.faction='player';npc.battleEntityId='u9';
const records=recordBattleRecruit([],npc);
// Hired merc dies; Talk recruit survives. The surviving recruit has an unambiguous
// battleEntityId also recorded in records[0].entityId.
const survivors=[...r.getRoster().filter(u=>u.name!==merc.name),npc];
const legacy=JSON.parse(JSON.stringify(r.toJSON()));delete legacy.nextUnitUid;
const loaded=RunManager.fromJSON(legacy,d);
const fallen=fallenBattleRecruits(records,survivors,loaded.roster);
loaded.completeBattle(survivors,node.id,0,{fallenRecruits:fallen});
const summary=u=>({name:u.name,level:u.level,uid:u.unitUid,stats:u.stats});
console.log(JSON.stringify({recordEntity:records[0].entityId,survivorEntity:npc.battleEntityId,deadMercBefore:summary(merc),livingRecruitBefore:summary(npc),wronglyReportedFallen:fallen.map(summary),actualFallen:loaded.fallenUnits.map(summary),actualLiving:loaded.roster.filter(u=>u.name===merc.name).map(summary)},null,2));
