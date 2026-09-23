import {mkdir,readFile,writeFile,rename,statfs,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {Client,accounts} from './local-api.mjs';
import {runtimeUrl} from './runtime-paths.mjs';
import {packGltf} from './pack-gltf.mjs';
import {modelTopic as topic} from './model-topic.mjs';
const {validateGlb}=await import(runtimeUrl('build/server/learning/validation.js'));
const packId='models-2000-20260921',target=300,ua='LearningObservatory/0.3 educational CC0 collection';
const root=runtimeUrl('materials-2000/poly-models/'),delivery=root;
for(const url of [root,new URL('records/',root),new URL('assets/',root),delivery,new URL('assets/',delivery)])await mkdir(url,{recursive:true});
const hash=(bytes,algorithm='sha256')=>createHash(algorithm).update(bytes).digest('hex');
async function load(url){try{return JSON.parse(await readFile(url,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;return null;}}
async function save(url,value){const tmp=new URL(url.href+'.partial');await writeFile(tmp,JSON.stringify(value,null,2)+'\n','utf8');await rename(tmp,url);}
async function download(url,maxBytes=24*1024*1024){
  const parsed=new URL(url);
  if(parsed.protocol!=='https:'||!['api.polyhaven.com','dl.polyhaven.org'].includes(parsed.hostname))throw new Error('Unapproved asset host');
  for(let i=0;i<3;i++)try{
    const response=await fetch(url,{headers:{'User-Agent':ua},redirect:'error',signal:AbortSignal.timeout(60000)});
    if(response.status===429){await response.body?.cancel();throw new Error('RATE_LIMIT_STOP');}
    if(!response.ok){await response.body?.cancel();throw new Error('HTTP '+response.status);}
    if(Number(response.headers.get('content-length'))>maxBytes){await response.body?.cancel();throw new Error('Source too large');}
    let size=0;const chunks=[];
    for await(const chunk of response.body){size+=chunk.length;if(size>maxBytes)throw new Error('Source too large');chunks.push(chunk);}
    return Buffer.concat(chunks);
  }catch(e){if(i===2||e.message==='RATE_LIMIT_STOP')throw e;await delay(1000*(i+1));}
}
async function verified(source){
  if(!source||!Number.isSafeInteger(source.size)||source.size>24*1024*1024||!/^[a-f0-9]{32}$/.test(source.md5))throw new Error('Source missing size/hash or too large');
  const bytes=await download(source.url);
  if(bytes.length!==source.size||hash(bytes,'md5')!==source.md5)throw new Error('Upstream integrity mismatch');
  return bytes;
}
const client=new Client();await client.login((await accounts()).admin);
const initial=await client.resources(),oldIds=new Set(initial.filter(r=>r.sourceName==='Poly Haven').map(r=>r.sourceAssetId));
const hashes=new Set(initial.map(r=>r.sha256));
let catalog=await load(new URL('catalog.json',root));
if(!catalog){catalog=JSON.parse((await download('https://api.polyhaven.com/assets?t=models')).toString('utf8'));await save(new URL('catalog.json',root),catalog);}
const groups=new Map();
for(const [id,info] of Object.entries(catalog).sort(([a],[b])=>a.localeCompare(b))){
  if(!/^[a-zA-Z0-9_-]+$/.test(id)||oldIds.has(id)||info.type!==2)continue;
  const category=topic(info)[0];if(!groups.has(category))groups.set(category,[]);groups.get(category).push([id,info]);
}
const candidates=[];while([...groups.values()].some(g=>g.length))for(const g of groups.values())if(g.length)candidates.push(g.shift());
const added=[],failures=[];
for(const file of await readdir(new URL('records/',root))){
  if(!file.endsWith('.json'))continue;
  const record=await load(new URL('records/'+file,root));
  if(record.phase==='published'&&initial.some(r=>r.scene===record.scene&&r.published))added.push(record);
}
console.log(JSON.stringify({packId,candidates:candidates.length,target}));
for(const [id,info] of candidates){
  if(added.length>=target)break;
  try{
    const disk=await statfs(fileURLToPath(runtimeUrl('')));
    if(disk.bavail*disk.bsize<3*1024**3)throw new Error('DISK_SPACE_STOP');
    const recordUrl=new URL('records/'+id+'.json',root),assetUrl=new URL('assets/'+id+'.glb',root);
    let record=await load(recordUrl),bytes;
    if(record){bytes=await readFile(assetUrl);if(hash(bytes)!==record.sha256)throw new Error('Cache hash mismatch');}
    else{
      const files=JSON.parse((await download('https://api.polyhaven.com/files/'+id,2*1024*1024)).toString('utf8'));
      const source=files.gltf?.['1k']?.gltf;
      if(!source)throw new Error('No 1k glTF package');
      const entries=Object.entries(source.include??{});
      if(entries.length>20||entries.reduce((n,[,file])=>n+file.size,source.size)>24*1024*1024)throw new Error('Package exceeds curated size limit');
      const gltfBytes=await verified(source),doc=JSON.parse(gltfBytes.toString('utf8')),resources=Object.create(null),provenanceFiles=[];
      for(const [uri,file] of entries){
        if(uri.includes('..')||uri.startsWith('/')||uri.includes(':'))throw new Error('Unsafe include path');
        resources[uri]=await verified(file);provenanceFiles.push({uri,...file,sha256:hash(resources[uri])});
      }
      bytes=packGltf(doc,resources);validateGlb(bytes);
      const [category,prompt]=topic(info),sourceUrl='https://polyhaven.com/a/'+id;
      const creator=(Object.keys(info.authors??{}).join('、')||'Poly Haven contributors').slice(0,160);
      record={packId,id,preparedAt:new Date().toISOString(),sha256:hash(bytes),byteSize:bytes.length,file:'assets/'+id+'.glb',
        provenance:{sourceUrl,evidenceUrl:'https://polyhaven.com/license',gltf:{...source,sha256:hash(gltfBytes)},files:provenanceFiles,authors:info.authors,license:'CC0-1.0'},
        metadata:{title:(category+' · '+info.name).slice(0,100),kind:'model',category,description:prompt,creator,sourceName:'Poly Haven',
          sourceAssetId:id,sourceSha256:hash(gltfBytes),sourceUrl,license:'CC0-1.0',licenseUrl:'https://creativecommons.org/publicdomain/zero/1.0/',
          attribution:creator+' · Poly Haven · CC0 1.0 · '+sourceUrl,
          modifications:'官方 1K 贴图 glTF 及其几何、贴图无损封装为独立 GLB；不改变几何或材质。逐文件 MD5、大小与 SHA-256 已记录。',
          rightsConfirmed:true,originalFileName:id+'.glb'},
        notes:[{id:'observe',title:'从多个方向观察',body:prompt}]};
      await writeFile(assetUrl,bytes,{flag:'wx'});await save(recordUrl,record);
    }
    if(hashes.has(record.sha256))throw new Error('Duplicate model content');
    hashes.add(record.sha256);
    await writeFile(new URL(record.file,delivery),bytes);
    if(!record.scene){({scene:record.scene}=await client.upload(bytes,record.metadata));record.phase='created';await save(recordUrl,record);}
    const prefix='/learn/api/resources/'+record.scene,detail=await client.json(prefix);
    await client.send(prefix+'/notes',{expectedVersion:detail.notes.version,entries:record.notes},'PUT');
    const upstream=await client.request('/scenes/'+record.scene+'/upstream-metadata.json',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({packId,...record.provenance})});
    if(!upstream.ok)throw new Error('Provenance attachment '+upstream.status);
    await client.send(prefix+'/publication',{published:true,redistributionConfirmed:true,evidenceUrl:'https://polyhaven.com/license',
      note:'官方 CC0 模型；几何和每张贴图已与 API 文件 MD5/大小逐项核验，仅打包为独立 GLB，保留来源、作者和加工说明。'});
    record.phase='published';await save(recordUrl,record);added.push(record);
    console.log(JSON.stringify({modelsAdded:added.length,target,id,scene:record.scene}));
  }catch(error){failures.push({id,reason:error.message});console.error(JSON.stringify({skippedModel:id,reason:error.message}));if(/RATE_LIMIT_STOP|DISK_SPACE_STOP|413:|401:|403:/.test(error.message))break;}
  await delay(350);
}
const manifest={packId,updatedAt:new Date().toISOString(),target,addedCount:added.length,failures,resources:added};
await save(new URL('import-results.json',root),manifest);await save(new URL('manifest.json',delivery),manifest);
console.log(JSON.stringify({finished:true,modelsAdded:added.length,failures:failures.length}));
if(added.length<target)process.exitCode=1;
