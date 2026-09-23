import {readFile,writeFile,readdir,rename} from 'node:fs/promises';
import {Client,accounts} from './local-api.mjs';
import {runtimeUrl} from './runtime-paths.mjs';
const root=runtimeUrl('materials-2000/');
const clean=s=>String(s??'').replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/[\u0000-\u001f]/g,' ').trim();
const client=new Client();await client.login((await accounts()).admin);
const updated=[],failures=[];
try{
 for(const folder of ['commons','commons-extended'])for(const name of await readdir(new URL(folder+'/records/',root))){
  if(!name.endsWith('.json'))continue;
  const file=new URL(folder+'/records/'+name,root),record=JSON.parse(await readFile(file,'utf8'));
  if(!['published','credit-review'].includes(record.phase))continue;
  const requested=clean(record.provenance.imageinfo.extmetadata.Attribution?.value);
  if(!requested)continue;
  const old=record.metadata.attribution;
  if(old.includes(requested)&&record.phase==='published')continue;
  const desired=old.includes(requested)?old:old+'；指定署名：'+requested;
  try{
   if(desired.length>2000)throw Error('Custom attribution exceeds limit');
   const prefix='/learn/api/resources/'+record.scene,current=await client.json(prefix);
   if(current.sourceName!=='Wikimedia Commons'||current.sourceAssetId!==record.id)throw Error('Source identity changed');
   if(current.attribution!==old&&current.attribution!==desired)throw Error('Concurrent credit change; manual review needed');
   record.phase='credit-review';record.metadata.attribution=desired;
   const save=async()=>{const tmp=new URL(file.href+'.credit-partial');await writeFile(tmp,JSON.stringify(record,null,2)+'\n','utf8');await rename(tmp,file);};
   await save();
   if(current.attribution!==desired)await client.send(prefix,{...record.metadata,expectedVersion:current.version},'PATCH');
   await client.send(prefix+'/publication',{published:true,redistributionConfirmed:true,evidenceUrl:record.metadata.sourceUrl,note:'在原作者、来源、许可和处理说明外，逐字保留文件页指定署名，包括版权标记与作者主页；文件不变。'});
   record.phase='published';record.creditVerifiedAt=new Date().toISOString();await save();
   updated.push(record.scene);
   if(updated.length%25===0)console.log(JSON.stringify({customCreditsCompleted:updated.length}));
  }catch(e){failures.push({scene:record.scene,error:e.message});}
 }
}finally{await client.send('/auth/logout',{});}
await writeFile(new URL('custom-credit-review.json',root),JSON.stringify({checkedAt:new Date().toISOString(),updated,failures},null,2)+'\n','utf8');
console.log(JSON.stringify({updated:updated.length,failures}));
if(failures.length)process.exitCode=1;
