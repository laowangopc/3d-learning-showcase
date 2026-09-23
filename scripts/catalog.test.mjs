import test from 'node:test';
import assert from 'node:assert/strict';
import {filterResources,initialResource,collectResourcePages} from '../portal/catalog.mjs';
import {Client} from './local-api.mjs';

const resources=[
  {scene:'private',title:'心脏 · 待授权复核',kind:'model',category:'人体与健康',published:false,canEdit:true,sourceName:'thebuggeddev/anatomy'},
  {scene:'pano',title:'森林',kind:'panorama',category:'自然科学',published:true},
  {scene:'kidney',title:'肾脏 · 女性参考',kind:'model',category:'人体器官',published:true,sourceName:'Human Reference Atlas'},
  {scene:'heart',title:'心脏 · 女性参考',kind:'model',category:'人体器官',published:true,sourceName:'Human Reference Atlas'}
];
test('default opens a licensed public heart, never the older private review pack',()=>assert.equal(initialResource(resources).scene,'heart'));
test('deep link takes precedence over featured heart',()=>assert.equal(initialResource(resources,'kidney').scene,'kidney'));
test('anatomy theme does not conflate clothing and body pose with organs',()=>assert.equal(filterResources(resources,{category:'人体器官'}).length,2));
test('Chinese search, type and source filters compose',()=>{
  assert.deepEqual(filterResources(resources,{category:'人体器官',kind:'model',search:'肾脏'}).map(r=>r.scene),['kidney']);
  assert.equal(filterResources(resources,{search:'human reference atlas'}).length,2);
  assert.equal(filterResources(resources,{category:'人体器官',kind:'panorama'}).length,0);
});
test('private uploads remain discoverable to their owner',()=>assert.equal(filterResources(resources,{mine:true})[0].scene,'private'));
test('original Anatomy source filter keeps review assets separate from public organs',()=>assert.deepEqual(filterResources(resources,{source:'thebuggeddev/anatomy'}).map(r=>r.scene),['private']));
test('empty catalog is safe',()=>assert.equal(initialResource([]),undefined));
test('concurrent uploads shifting offset pages cannot inflate catalog counts',async()=>{
  const pages=[{resources:[{scene:'a'},{scene:'b'}],nextOffset:2},{resources:[{scene:'b'},{scene:'c'}],nextOffset:null}];
  assert.deepEqual((await collectResourcePages(()=>pages.shift())).map(r=>r.scene),['a','b','c']);
});
test('missing or invalid page cursor fails closed',async()=>{
  await assert.rejects(()=>collectResourcePages(async()=>({resources:[]})),/did not advance/);
  await assert.rejects(()=>collectResourcePages(async()=>({resources:[{}],nextOffset:null})),/scene is missing/);
});
test('import catalog paginates beyond 100 resources',async()=>{
  const client=new Client(); const calls=[];
  client.json=async path=>{calls.push(path);return path.endsWith('=0')?{resources:Array.from({length:100},(_,i)=>({scene:String(i)})),nextOffset:100}:{resources:[{scene:'101'}],nextOffset:null};};
  assert.equal((await client.resources()).length,101);assert.equal(calls.length,2);
});
test('broken pagination fails instead of looping',async()=>{
  const client=new Client();client.json=async()=>({resources:[],nextOffset:0});
  await assert.rejects(()=>client.resources(),/did not advance/);
});
test('busy upload is safely retried but an ambiguous network failure is not',async()=>{
  const client=new Client();let calls=0;
  client.uploadResponse=async()=>++calls===1?{status:429,ok:false,json:async()=>({message:'busy'})}:{status:200,ok:true,json:async()=>({scene:'created'})};
  assert.equal((await client.upload(Buffer.alloc(1),{})).scene,'created');assert.equal(calls,2);
  calls=0;client.uploadResponse=async()=>{calls++;throw new Error('connection lost');};
  await assert.rejects(()=>client.upload(Buffer.alloc(1),{}),/connection lost/);assert.equal(calls,1);
});
