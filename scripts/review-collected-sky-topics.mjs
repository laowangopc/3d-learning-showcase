import assert from 'node:assert/strict';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {Client,accounts} from './local-api.mjs';
import {runtimeUrl} from './runtime-paths.mjs';
const catalog=JSON.parse(await readFile(runtimeUrl('samples/resource-1000/catalog.json'),'utf8'));
const client=new Client();await client.login((await accounts()).admin);
const category='天空与光照',prompt='观察云层、天空色彩和光照变化。这是来源方提供的纯天空专题影像，不代表完整地面现场，也不用于定量光照测量。';
let reviewed=0;
for(const file of await readdir(runtimeUrl('samples/resource-1000/records/'))){
  if(!file.endsWith('.json'))continue;
  const path=runtimeUrl('samples/resource-1000/records/'+file),record=JSON.parse(await readFile(path,'utf8'));
  if(record.phase!=='published'||record.packId!=='resource-1000-20260921'||!catalog[record.id]?.categories?.includes('pure skies'))continue;
  const prefix='/learn/api/resources/'+record.scene,current=await client.json(prefix);
  assert.equal(current.sha256,record.sha256);assert.equal(current.sourceAssetId,record.id);
  assert(current.published,'Do not override a later unpublication decision');
  if(current.category===category)continue;
  record.metadata={...record.metadata,category,title:(category+' · '+catalog[record.id].name).slice(0,100),description:prompt};
  await client.send(prefix,{...record.metadata,expectedVersion:current.version},'PATCH');
  record.notes=[{id:'observe',title:'观察天空',body:prompt,position:{yaw:0,pitch:0}}];
  await client.send(prefix+'/notes',{entries:record.notes,expectedVersion:current.notes.version},'PUT');
  await client.send(prefix+'/publication',{published:true,redistributionConfirmed:true,evidenceUrl:'https://polyhaven.com/license',
    note:'官方 CC0 资源，原始文件大小和 MD5 已核对；按照来源方 pure skies 分类标注为纯天空专题影像，不宣称地面现场复原。'});
  record.topicReview={at:new Date().toISOString(),providerCategory:'pure skies'};
  await writeFile(path,JSON.stringify(record,null,2)+'\n','utf8');reviewed++;
}
console.log(JSON.stringify({status:'passed',reviewed}));
