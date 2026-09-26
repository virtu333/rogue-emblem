import assert from 'node:assert/strict';
import {NativeSaveMirror,MIRROR_SENTINEL_KEY,encodeRecord,recordFileNames,collectRecords} from '../../../src/utils/nativeSaveMirror.js';
const key='emblem_rogue_slot_1_run';
const value=stamp=>JSON.stringify({savedAt:stamp});
const files=new Map([[recordFileNames(key)[0],encodeRecord({key,seq:2,value:null,deletedSavedAt:100})]]);
const backend={list:async()=>[...files.keys()],read:async k=>files.get(k),write:async(k,v)=>files.set(k,v)};
class Storage {
  constructor(v){this.data=new Map([[MIRROR_SENTINEL_KEY,'1'],...(v?[[key,v]]:[])]);}
  get length(){return this.data.size;}
  key(i){return [...this.data.keys()][i]??null;}
  getItem(k){return this.data.get(k)??null;}
  setItem(k,v){this.data.set(k,String(v));}
  removeItem(k){this.data.delete(k);}
  clear(){this.data.clear();}
}
const launch=async local=>{const m=new NativeSaveMirror({storage:local,backend,setTimer:()=>0,clearTimer:()=>{}});await m.restore();return m;};
// Original finding is fixed for a newly stamped tombstone.
let local=new Storage(value(100));
let mirror=await launch(local);
assert.equal(local.getItem(key),null);
console.log('PASS: stale save100 removed by tombstone100');
// Newer local run must survive the older tombstone.
local=new Storage(value(200));
mirror=await launch(local);
assert.equal(local.getItem(key),value(200));
console.log('PASS: newer save200 retained against tombstone100');
// New lifecycle: old run is deleted; another run is written then deleted
// before a mirror flush. WebKit may retain that intermediate value on kill.
local=new Storage();
mirror=await launch(local);
const unhook=mirror.hookStorage(Storage.prototype,local);
local.setItem(key,value(200));
local.removeItem(key);
await mirror.flush();
unhook();
const record=collectRecords(Object.fromEntries(files)).records.get(key);
console.log('After second run write+delete, native tombstone:',record);
assert.equal(record.deletedSavedAt,100);
local=new Storage(value(200));
mirror=await launch(local);
console.log('After relaunch with lost local deletion:',local.getItem(key));
assert.equal(local.getItem(key),value(200));
await mirror.flush();
console.log('Native after reconciliation:',collectRecords(Object.fromEntries(files)).records.get(key));
