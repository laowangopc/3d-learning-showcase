import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {Client,accounts} from './local-api.mjs';
import {runtimeUrl,runtimeDependency} from './runtime-paths.mjs';
const sharp=runtimeDependency('sharp');sharp.concurrency(1);sharp.cache(false);
const folder=process.env.COMMONS_PACK||'commons';
if(!['commons','commons-extended'].includes(folder))throw Error('Invalid collection folder');
const category=process.env.COMMONS_CATEGORY||'Category:360° panoramas';
const excludeCategory=process.env.COMMONS_EXCLUDE_CATEGORY;
const root=runtimeUrl('materials-2000/'+folder+'/');
for(const p of ['', 'assets/','records/'])await mkdir(new URL(p,root),{recursive:true});
const ua='AnatomyUnified/1.0 (educational licensed panorama collection; Wikimedia Commons attribution retained)';
const hash=(b,a='sha256')=>createHash(a).update(b).digest('hex');
const clean=s=>String(s??'').replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/[\u0000-\u001f]/g,' ').trim();
async function save(url,value){const tmp=new URL(url.href+'.partial');await writeFile(tmp,JSON.stringify(value,null,2),'utf8');await rename(tmp,url);}
async function load(url){try{return JSON.parse(await readFile(url,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;return null;}}
async function get(url,max=40*1024*1024){
 const u=new URL(url);if(u.protocol!=='https:'||!['commons.wikimedia.org','upload.wikimedia.org','thumb.wikimedia.org'].includes(u.hostname))throw Error('Unapproved host');
 for(let attempt=0;attempt<3;attempt++)try{
  const r=await fetch(url,{headers:{'User-Agent':ua},redirect:'error',signal:AbortSignal.timeout(90000)});
  if(r.status===429){const retry=r.headers.get('retry-after');await r.body?.cancel();await save(new URL('rate-limit.json',root),{at:new Date().toISOString(),retryAfter:retry,host:u.hostname});throw Error('RATE_LIMIT_STOP retry-after='+retry);}
  if(!r.ok){await r.body?.cancel();throw Error('HTTP '+r.status);}
  if(Number(r.headers.get('content-length'))>max){await r.body?.cancel();throw Error('Oversized');}
  let n=0;const chunks=[];for await(const b of r.body){n+=b.length;if(n>max)throw Error('Oversized');chunks.push(b);}return Buffer.concat(chunks);
 }catch(e){if(e.message.startsWith('RATE_LIMIT_STOP')||attempt===2)throw e;await delay(1500*(attempt+1));}
}
function classify(title,categories){
 const t=(title+' '+categories).toLowerCase();
 if(/museum|church|cathedral|temple|palace|castle|monastery|heritage/.test(t))return '文化遗产与建筑';
 if(/forest|garden|park|tree|woodland/.test(t))return '森林与植被';
 if(/beach|river|lake|sea |coast|ocean/.test(t))return '水域与海岸';
 if(/mountain|desert|cave|glacier|volcan|valley/.test(t))return '地貌与气候';
 if(/factory|industrial|station|railway|bridge|workshop/.test(t))return '交通与工业空间';
 return '城市与环境';
}
const client=new Client();await client.login((await accounts()).admin);
const initial=await client.resources();
const sourceIds=new Set(initial.filter(r=>r.published&&r.sourceName==='Wikimedia Commons').map(r=>r.sourceAssetId));
const hashes=new Set(initial.filter(r=>r.published).map(r=>r.sha256)),sourceHashes=new Set(initial.filter(r=>r.published).map(r=>r.sourceSha256).filter(Boolean));
const failures=[],added=[];let stop=false,publicCount=initial.filter(r=>r.published).length;
const target=Number(process.env.RESOURCE_TARGET||2000);
let cursor;const stateUrl=new URL('state.json',root);const state=await load(stateUrl);cursor=(!state?.category||state.category===category)?state?.cursor:undefined;
async function processPage(page){
 const id=String(page.pageid);if(sourceIds.has(id)||stop||publicCount>=target)return;
 const info=page.imageinfo?.[0],e=info?.extmetadata??{};
 // A parallel category collection excludes the main collector's entire source category.
 if(excludeCategory&&String(e.Categories?.value||'').split('|').includes(excludeCategory))return;
 const licenses={'cc-by-4.0':'CC-BY-4.0','cc-by-sa-4.0':'CC-BY-SA-4.0','cc-zero':'CC0-1.0'};
 const license=licenses[e.License?.value];
 // Only the official 3840px rendition is decoded: the original's large pixel/file
 // count is not a memory cost here. Download and decoded-rendition limits remain enforced.
 if(!info||!license||e.Restrictions?.value||!Number.isSafeInteger(info.width)||info.width!==2*info.height||info.width<2048||!/\.jpe?g(?:\?|$)/i.test(info.url))return;
 const meta=Object.fromEntries((info.metadata??[]).map(x=>[x.name,String(x.value)]));
 if(meta.ProjectionType&&meta.ProjectionType!=='equirectangular')return;
 if(meta.FullPanoWidthPixels&&(Number(meta.FullPanoWidthPixels)!==info.width||Number(meta.FullPanoHeightPixels)!==info.height||Number(meta.CroppedAreaTopPixels||0)!==0||Number(meta.CroppedAreaLeftPixels||0)!==0))return;
 const author=clean(e.Artist?.value);if(!author||author.length>160)return;
 const licenseUrl=String(e.LicenseUrl?.value||'');
 const expected=license==='CC0-1.0'?'https://creativecommons.org/publicdomain/zero/1.0/':`https://creativecommons.org/licenses/${license==='CC-BY-4.0'?'by':'by-sa'}/4.0/`;
 if(licenseUrl.replace(/^http:/,'https:').replace(/\/$/,'')!==expected.replace(/\/$/,''))return;
 const recordUrl=new URL('records/'+id+'.json',root),assetUrl=new URL('assets/'+id+'.jpg',root);
 try{
  let record=await load(recordUrl),bytes;
  if(record){bytes=await readFile(assetUrl);if(hash(bytes)!==record.sha256)throw Error('Cached hash mismatch');}
  else{
   if(!info.thumburl)throw Error('No official display rendition');
   const original=await get(info.thumburl,12*1024*1024);
   const sourceSha256=hash(original);if(sourceHashes.has(sourceSha256))return;
   const dimensions=await sharp(original,{limitInputPixels:128*1024*1024}).metadata();
   if(dimensions.width!==2*dimensions.height||dimensions.width<2048)throw Error('Display rendition is not a complete 2:1 sphere');
   bytes=await sharp(original).resize(2048,1024).jpeg({quality:88}).toBuffer();
   const category=classify(page.title,e.Categories?.value);
   const title=clean(page.title.replace(/^File:/,'').replace(/\.jpe?g$/i,''));
   const description='在完整球形影像中观察建筑、地形、空间尺度和采光关系。仅支持原地环顾，不支持自由行走；地点及拍摄日期以来源记录为准。';
   record={packId:'commons-2000-20260921',id,file:'assets/'+id+'.jpg',preparedAt:new Date().toISOString(),sha256:hash(bytes),sourceSha256,byteSize:bytes.length,
    provenance:{pageId:page.pageid,title:page.title,imageinfo:info,retrievedAt:new Date().toISOString(),downloadedUrl:info.thumburl,downloadedRenditionSha256:sourceSha256,apiReportedOriginalSha1:info.sha1,originalBinaryDownloaded:false},
    metadata:{title:(category+' · '+title).slice(0,100),kind:'panorama',category,description,creator:author,sourceName:'Wikimedia Commons',sourceAssetId:id,sourceSha256,sourceUrl:info.descriptionurl,license,licenseUrl:expected,
     attribution:`${title} — ${author} — ${license} — ${info.descriptionurl}`+(e.Attribution?.value?'；指定署名：'+clean(e.Attribution.value):''),
     modifications:'由 Wikimedia 官方展示尺寸 JPEG 等比缩小为 2048×1024；未下载原始高分辨率文件。保留完整球形构图，不合成场景，记录下载文件 SHA-256。衍生文件沿用原作品许可，包括适用的相同方式共享条款。',rightsConfirmed:true,originalFileName:id+'.jpg'}};
   if(record.metadata.attribution.length>2000)throw Error('Attribution too long');
   await writeFile(assetUrl,bytes,{flag:'wx'});await save(recordUrl,record);
  }
  if(hashes.has(record.sha256)||sourceHashes.has(record.sourceSha256))return;
  hashes.add(record.sha256);sourceHashes.add(record.sourceSha256);
  if(!record.scene){({scene:record.scene}=await client.upload(bytes,record.metadata));record.phase='created';await save(recordUrl,record);}
  const prefix='/learn/api/resources/'+record.scene;
  const provenance=await client.request('/scenes/'+record.scene+'/upstream-metadata.json',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(record.provenance)});
  if(!provenance.ok)throw Error('Provenance '+provenance.status);
  // Panorama uploads already generate their own thumbnail; model-only cover API is not used.
  await client.send(prefix+'/publication',{published:true,redistributionConfirmed:true,evidenceUrl:info.descriptionurl,note:'依据作品文件页许可及作者署名收录；核验下载文件 SHA-256 和完整 2:1 球形投影；衍生文件遵循同一许可，保存原始授权元数据和加工来源。'});
  record.phase='published';await save(recordUrl,record);added.push(record.scene);sourceIds.add(id);publicCount++;
  console.log(JSON.stringify({public:publicCount,target,commonsAdded:added.length,id}));
 }catch(error){failures.push({id,error:error.message});console.error(JSON.stringify({skipped:id,error:error.message}));if(/RATE_LIMIT_STOP|401:|403:|413:/.test(error.message))stop=true;}
 await delay(3000);
}
try{
 for(let batch=0;batch<300&&!stop;batch++){
  publicCount=(await client.resources()).filter(r=>r.published).length;if(publicCount>=target)break;
  const q=new URLSearchParams({action:'query',generator:'categorymembers',gcmtitle:category,gcmtype:'file',gcmlimit:'50',prop:'imageinfo',iiprop:'url|size|sha1|extmetadata|metadata',iiurlwidth:'3840',format:'json',maxlag:'5',...(cursor?{gcmcontinue:cursor}:{})});
  const data=JSON.parse((await get('https://commons.wikimedia.org/w/api.php?'+q,8*1024*1024)).toString());if(data.error)throw Error(JSON.stringify(data.error));
  const pages=Object.values(data.query?.pages??{});let i=0;
  async function worker(){while(i<pages.length&&!stop&&publicCount<target)await processPage(pages[i++]);}
  const workers=Math.max(1,Math.min(2,Number(process.env.COMMONS_WORKERS)||1));
  await Promise.all(Array.from({length:workers},()=>worker()));
  if(stop)break;
  cursor=data.continue?.gcmcontinue;
  await save(stateUrl,{category,cursor,publicCount,updatedAt:new Date().toISOString()});
  await save(new URL('report.json',root),{publicCount,target,added,failures});
  console.log(JSON.stringify({batch,publicCount,candidates:pages.length,failures:failures.length}));
  if(!cursor)break;await delay(1000);
 }
}finally{await client.send('/auth/logout',{});await save(new URL('report.json',root),{publicCount,target,added,failures,finishedAt:new Date().toISOString()});}
if(publicCount<target)process.exitCode=1;
