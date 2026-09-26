import {commitBattleDeeds} from '../../../src/engine/DeedSystem.js';
import {loadGameData} from '../../../tests/testData.js';
const data=loadGameData();
const unit=(name,isLord)=>({name,isLord,faction:'player',className:isLord?'Lord':'Archer',tier:'base',level:5,currentHP:20,stats:{HP:20},skills:[],col:0,row:0});
const survivors=[unit('Edric',true),unit('Sera',true),unit('Voss',true),unit('Leona',false)];
const result=commitBattleDeeds(survivors,data.deeds,{battleKey:'probe:all-four-alive',act:'act2',battle:1,deployedCount:4});
console.log(JSON.stringify({deployedCount:4,survivingCount:survivors.length,deaths:0,survivors:survivors.map(u=>({name:u.name,isLord:u.isLord,currentHP:u.currentHP})),announcements:result.map(a=>({unit:a.unit.name,deed:a.deedId,name:a.name,lore:a.lore}))},null,2));
