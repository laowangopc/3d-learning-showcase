import assert from 'node:assert/strict';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {Client,accounts} from './local-api.mjs';
import {runtimeUrl} from './runtime-paths.mjs';
import {modelTopic} from './model-topic.mjs';
const catalog=JSON.parse(await readFile(runtimeUrl('samples/models-1000/catalog.json'),'utf8'));
const client=new Client();await client.login((await accounts()).admin);
let reviewed=0;
for(const file of await readdir(runtimeUrl('samples/models-1000/records/'))){
  if(!file.endsWith('.json'))continue;
  const path=runtimeUrl('samples/models-1000/records/'+file),record=JSON.parse(await readFile(path,'utf8'));
  if(record.phase!=='published'||record.packId!=='models-1000-20260921')continue;
  const info=catalog[record.id];assert(info);
  const prefix='/learn/api/resources/'+record.scene,current=await client.json(prefix);
  assert.equal(current.sha256,record.sha256);assert.equal(current.sourceAssetId,record.id);
  assert(current.published,'Do not override a later unpublication decision');
  const [category,description]=modelTopic(info),title=(category+' · '+info.name).slice(0,100);
  if(current.title===title&&current.category===category&&current.description===description)continue;
  record.metadata={...record.metadata,category,description,title};
  await client.send(prefix,{...record.metadata,expectedVersion:current.version},'PATCH');
  record.notes=[{id:'observe',title:'从多个方向观察',body:description}];
  await client.send(prefix+'/notes',{entries:record.notes,expectedVersion:current.notes.version},'PUT');
  await client.send(prefix+'/publication',{published:true,redistributionConfirmed:true,evidenceUrl:'https://polyhaven.com/license',
    note:'依据官方 CC0 许可和文件 MD5/大小核验记录发布；教学主题以 Poly Haven 官方分类为依据，未改变模型文件。'});
  record.topicReview={at:new Date().toISOString(),providerCategory:info.category};
  await writeFile(path,JSON.stringify(record,null,2)+'\n','utf8');reviewed++;
}
console.log(JSON.stringify({status:'passed',reviewed}));
