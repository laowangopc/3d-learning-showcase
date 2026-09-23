import {mkdir,readFile,writeFile,rename,statfs,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {Client,accounts} from './local-api.mjs';
import {runtimeUrl,sourceUrl,runtimeDependency} from './runtime-paths.mjs';

// Curated actual assets, not links. Safe to resume; original resources are never modified.
const sharp=runtimeDependency('sharp');
sharp.concurrency(1);
sharp.cache({memory:32,files:0,items:20});
const target=1000, packId='resource-1000-20260921';
const ua='LearningObservatory/0.3 educational CC0 collection';
const license='https://polyhaven.com/license';
const root=runtimeUrl('samples/resource-1000/');
const delivery=sourceUrl('deliverables/resources-20260921/');
for(const folder of [root,new URL('assets/',root),new URL('records/',root),delivery,new URL('assets/',delivery)]) await mkdir(folder,{recursive:true});
const hash=(bytes,algorithm='sha256')=>createHash(algorithm).update(bytes).digest('hex');
async function jsonFile(url){try{return JSON.parse(await readFile(url,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;return null;}}
async function save(url,value){const tmp=new URL(url.href+'.partial');await writeFile(tmp,JSON.stringify(value,null,2)+'\n','utf8');await rename(tmp,url);}
async function fetchBytes(url,maxBytes){
  const host=new URL(url);
  if(host.protocol!=='https:' || !['api.polyhaven.com','dl.polyhaven.org'].includes(host.hostname))throw new Error('Unapproved source host');
  for(let attempt=0;attempt<3;attempt++){
    try{
      const response=await fetch(url,{headers:{'User-Agent':ua,Accept:'*/*'},redirect:'error',signal:AbortSignal.timeout(90000)});
      if(response.status===429){await response.body?.cancel();throw new Error('RATE_LIMIT_STOP');}
      if(!response.ok){await response.body?.cancel();throw new Error('HTTP '+response.status);}
      if(Number(response.headers.get('content-length'))>maxBytes){await response.body?.cancel();throw new Error('Source too large');}
      const chunks=[];let size=0;
      for await(const chunk of response.body){size+=chunk.length;if(size>maxBytes)throw new Error('Source too large');chunks.push(chunk);}
      return Buffer.concat(chunks);
    }catch(error){
      if(error.message==='RATE_LIMIT_STOP'||attempt===2)throw error;
      await delay(1000*(attempt+1));
    }
  }
}
const client=new Client();await client.login((await accounts()).admin);
const initial=await client.resources();
const baselineUrl=runtimeUrl('output/resource-1000-baseline.json');
if(!await jsonFile(baselineUrl))await save(baselineUrl,{createdAt:new Date().toISOString(),resources:initial});
const oldIds=new Set(initial.filter(r=>r.sourceName==='Poly Haven').map(r=>r.sourceAssetId));
const hashes=new Set(initial.map(r=>r.sha256));
const sourceHashes=new Set(initial.map(r=>r.sourceSha256).filter(Boolean));
let publicCount=initial.filter(r=>r.published).length;
let catalog=await jsonFile(new URL('catalog.json',root));
if(!catalog){
  catalog=JSON.parse((await fetchBytes('https://api.polyhaven.com/assets?t=hdris',8*1024*1024)).toString('utf8'));
  await save(new URL('catalog.json',root),catalog);
}
function topic(info){
  if((info.categories??[]).includes('pure skies'))return ['天空与光照','观察云层、天空色彩和光照变化。这是来源方提供的纯天空专题影像，不代表完整地面现场，也不用于定量光照测量。'];
  const tags=[...(info.categories??[]),...(info.tags??[]),info.category??''].join(' ').toLowerCase();
  if(/industrial|factory|workshop|warehouse|hangar|machinery/.test(tags))return ['工业空间','观察结构支撑、采光、通道及设备的空间关系。'];
  if(/forest|woodland|jungle|tree|garden|park/.test(tags))return ['森林与植被','比较植被层次、地表覆盖和光照方向，记录可辨认的生态环境特征。'];
  if(/coast|beach|ocean|sea |river|lake|waterfall/.test(tags))return ['水域与海岸','观察水体、岸线及周围地形之间的关系。'];
  if(/desert|mountain|rock|arid|snow|hill/.test(tags))return ['地貌与气候','观察地形起伏、岩土和植被覆盖，区分直接观察与对环境的推测。'];
  if(/urban|street|city|courtyard|architecture|building/.test(tags))return ['城市与建筑','观察建筑立面、街道、公共空间与人的尺度关系。'];
  if((info.categories??[]).includes('indoor'))return ['室内空间','观察功能分区、家具尺度、采光和通行路径。'];
  return ['自然与环境','环顾场景，记录地表、天空及光照的关系。'];
}
// Interleave categories rather than filling the catalog from one alphabetic location.
const groups=new Map();
for(const [id,info] of Object.entries(catalog).sort(([a],[b])=>a.localeCompare(b))){
  if(!/^[a-z0-9_-]+$/.test(id)||oldIds.has(id)||info.type!==0)continue;
  if((info.categories??[]).includes('studio'))continue;
  const key=topic(info)[0];if(!groups.has(key))groups.set(key,[]);groups.get(key).push([id,info]);
}
const candidates=[];
while([...groups.values()].some(g=>g.length))for(const group of groups.values())if(group.length)candidates.push(group.shift());
let cursor=0,stop=false;
const failures=[],added=[];
console.log(JSON.stringify({packId,initial:initial.length,public:publicCount,candidates:candidates.length,target}));
async function prepare(id,info){
  const recordUrl=new URL('records/'+id+'.json',root);
  let record=await jsonFile(recordUrl);
  const assetUrl=new URL('assets/'+id+'.jpg',root);
  if(record){
    const bytes=await readFile(assetUrl);
    if(hash(bytes)!==record.sha256)throw new Error('Cached asset hash mismatch');
    return {record,bytes,recordUrl};
  }
  const disk=await statfs(fileURLToPath(runtimeUrl('')));
  if(disk.bavail*disk.bsize<3*1024**3)throw new Error('DISK_SPACE_STOP');
  const files=JSON.parse((await fetchBytes('https://api.polyhaven.com/files/'+id,2*1024*1024)).toString('utf8'));
  const source=files.tonemapped;
  if(!source||!Number.isSafeInteger(source.size)||source.size>80*1024*1024||!/^[a-f0-9]{32}$/.test(source.md5))throw new Error('No bounded verifiable tonemapped panorama');
  const original=await fetchBytes(source.url,80*1024*1024);
  if(original.length!==source.size||hash(original,'md5')!==source.md5)throw new Error('Original MD5 or length mismatch');
  const originalSha256=hash(original);
  if(sourceHashes.has(originalSha256))throw new Error('Duplicate source content');
  const input=sharp(original,{limitInputPixels:128*1024*1024,failOn:'warning'});
  const dimensions=await input.metadata();
  if(dimensions.width!==dimensions.height*2||dimensions.width<2048)throw new Error('Not a complete 2:1 sphere');
  const bytes=await input.resize(2048,1024).jpeg({quality:88}).toBuffer();
  const [category,prompt]=topic(info);
  const title=(category+' · '+info.name).slice(0,100);
  const sourceUrl='https://polyhaven.com/a/'+id;
  const creator=(Object.keys(info.authors??{}).join('、')||'Poly Haven contributors').slice(0,160);
  record={
    packId,id,preparedAt:new Date().toISOString(),sha256:hash(bytes),byteSize:bytes.length,
    file:'assets/'+id+'.jpg',originalSha256,
    provenance:{sourceUrl,evidenceUrl:license,apiUrl:'https://api.polyhaven.com/files/'+id,apiFile:source,
      originalDimensions:{width:dimensions.width,height:dimensions.height},authors:info.authors,
      sourceName:info.name,categories:info.categories,tags:info.tags,coordinates:info.coords??null,license:'CC0-1.0'},
    metadata:{title,kind:'panorama',description:prompt+' 完整球形全景支持环顾，不支持自由行走；拍摄地点和物体身份以来源记录为准。',
      category,creator,sourceName:'Poly Haven',sourceAssetId:id,sourceSha256:originalSha256,sourceUrl,
      license:'CC0-1.0',licenseUrl:'https://creativecommons.org/publicdomain/zero/1.0/',
      attribution:creator+' · Poly Haven · CC0 1.0 · '+sourceUrl,
      modifications:'由官方色调映射全景等比缩小为 2048×1024 JPEG；未合成场景。原图 MD5 和 SHA-256 已记录。',
      rightsConfirmed:true,originalFileName:id+'.jpg'},
    notes:[{id:'observe',title:'环顾与比较',body:prompt+' 先转动一周，再选择前后或左右两个方向比较。',position:{yaw:0,pitch:0}}],
  };
  await writeFile(assetUrl,bytes,{flag:'wx'});
  await save(recordUrl,record);
  return {record,bytes,recordUrl};
}
async function worker(){
  while(!stop&&publicCount<target&&cursor<candidates.length){
    const [id,info]=candidates[cursor++];
    try{
      const {record,bytes,recordUrl}=await prepare(id,info);
      if(hashes.has(record.sha256)||sourceHashes.has(record.originalSha256))throw new Error('Duplicate content');
      hashes.add(record.sha256);sourceHashes.add(record.originalSha256);
      // Delivery contains the exact served asset; original high-resolution downloads stay in memory.
      await writeFile(new URL(record.file,delivery),bytes);
      if(!record.scene){
        ({scene:record.scene}=await client.upload(bytes,record.metadata));
        record.phase='created';await save(recordUrl,record);
      }
      const prefix='/learn/api/resources/'+record.scene;
      const detail=await client.json(prefix);
      await client.send(prefix+'/notes',{expectedVersion:detail.notes.version,entries:record.notes},'PUT');
      const upstream=await client.request('/scenes/'+record.scene+'/upstream-metadata.json',{
        method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({packId,...record.provenance,originalSha256:record.originalSha256})});
      if(!upstream.ok)throw new Error('Provenance attachment '+upstream.status);
      await client.send(prefix+'/publication',{published:true,redistributionConfirmed:true,evidenceUrl:license,
        note:'依据 Poly Haven 官方 CC0 资产许可和公开 API 使用条款收录；逐件核验官方文件 MD5、大小及完整 2:1 球形投影，保留作者、来源和处理说明。'});
      record.phase='published';record.publishedAt=new Date().toISOString();await save(recordUrl,record);
      added.push(record);publicCount++;
      console.log(JSON.stringify({public:publicCount,target,added:added.length,id,scene:record.scene}));
    }catch(error){
      failures.push({id,reason:error.message});console.error(JSON.stringify({skipped:id,reason:error.message}));
      if(/RATE_LIMIT_STOP|DISK_SPACE_STOP|413:|401:|403:/.test(error.message))stop=true;
    }
    await delay(350);
  }
}
await Promise.all([worker(),worker()]);
const current=await client.resources();
const cumulative=[];
for(const file of await readdir(new URL('records/',root))){
  if(!file.endsWith('.json'))continue;
  const record=await jsonFile(new URL('records/'+file,root));
  if(record.phase==='published'&&current.some(r=>r.scene===record.scene&&r.published))cumulative.push(record);
}
const manifest={packId,updatedAt:new Date().toISOString(),target,publicCount:current.filter(r=>r.published).length,
  totalCount:current.length,addedCount:added.length,failures,resources:cumulative};
await save(runtimeUrl('output/resource-1000-import.json'),manifest);
await save(new URL('manifest.json',delivery),manifest);
console.log(JSON.stringify({finished:true,public:manifest.publicCount,total:manifest.totalCount,added:added.length,failures:failures.length}));
if(manifest.publicCount<target)process.exitCode=1;
