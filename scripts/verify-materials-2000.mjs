import assert from 'node:assert/strict';
import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Client,accounts} from './local-api.mjs';
import {runtimeDependency,runtimeUrl} from './runtime-paths.mjs';
const sharp=runtimeDependency('sharp');sharp.concurrency(1);sharp.cache(false);
const {validateGlb}=await import(runtimeUrl('build/server/learning/validation.js'));
const root=runtimeUrl('materials-2000/');
const json=async u=>JSON.parse(await readFile(u,'utf8'));
const save=async(u,v)=>writeFile(u,JSON.stringify(v,null,2)+'\n','utf8');
const hash=b=>createHash('sha256').update(b).digest('hex');
const admin=new Client(),visitor=new Client();await admin.login((await accounts()).admin);
try{
 const all=await admin.resources(),publicResources=await visitor.resources();
 const current=new Map(all.map(r=>[r.scene,r]));
 const baseline=await json(new URL('poly-panoramas/baseline.json',root));
 const failures=[],checked=[],packs=[],pendingCovers=[],newScenes=new Set();
 let privateOriginalsProtected=0;
 for(const folder of ['poly-models','poly-panoramas','commons','commons-extended'])for(const file of await readdir(new URL(folder+'/records/',root))){
  if(file.endsWith('.json')){const r=await json(new URL(folder+'/records/'+file,root));if(r.scene)newScenes.add(r.scene);}
 }
 // The panorama snapshot was taken after model imports began. Exclude this pack's journals,
 // including two early Commons uploads that were still private when that snapshot was made.
 const originals=baseline.resources.filter(r=>!newScenes.has(r.scene));
 for(const old of originals){
  const now=current.get(old.scene);
  if(!now){failures.push({scene:old.scene,error:'Baseline scene missing'});continue;}
  for(const key of ['sha256','published','license','sourceUrl','creator','title']){
   if(now[key]!==old[key])failures.push({scene:old.scene,error:'Baseline changed: '+key});
  }
  if(!old.published){
   const response=await visitor.request(old.assetUrl);
   if([401,403,404].includes(response.status))privateOriginalsProtected++;
   else failures.push({scene:old.scene,error:'Original private asset accessible anonymously'});
   await response.body?.cancel();
  }
 }
 for(const folder of ['poly-models','poly-panoramas','commons','commons-extended']){
  const records=[];
  for(const file of await readdir(new URL(folder+'/records/',root))){
   if(!file.endsWith('.json'))continue;
   const r=await json(new URL(folder+'/records/'+file,root));
   if(r.phase==='published'&&current.get(r.scene)?.published)records.push(r);
  }
  await mkdir(new URL(folder+'/thumbnails/',root),{recursive:true});
  packs.push({folder,count:records.length});
  let index=0;
  await Promise.all(Array.from({length:2},async()=>{
   while(index<records.length){
    const record=records[index++],r=current.get(record.scene);
    try{
     assert.equal(r.sha256,record.sha256);assert.equal(r.license,record.metadata.license);
     for(const key of ['creator','sourceUrl','licenseUrl','attribution','modifications']){assert(r[key]);assert.equal(r[key],record.metadata[key]);}
     const local=await readFile(new URL(folder+'/'+record.file,root));assert.equal(hash(local),r.sha256);
     const response=await visitor.request(r.assetUrl);assert.equal(response.status,200);
     const live=Buffer.from(await response.arrayBuffer());assert.equal(hash(live),r.sha256);
     if(r.kind==='model')validateGlb(live);
     else{const image=await sharp(live).metadata();assert.equal(image.width,2048);assert.equal(image.height,1024);}
     const provenance=await visitor.json('/scenes/'+r.scene+'/upstream-metadata.json');
     assert(Object.keys(provenance).length>0);
     if(r.sourceName==='Wikimedia Commons'){
      assert.equal(String(provenance.pageId),r.sourceAssetId);
      const required=String(provenance.imageinfo.extmetadata.Attribution?.value??'').replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/[\u0000-\u001f]/g,' ').trim();
      if(required)assert(r.attribution.includes(required),'Custom attribution is missing');
     }
     else assert.equal(provenance.evidenceUrl,'https://polyhaven.com/license');
     if(r.thumbnailUrl){
      const coverResponse=await visitor.request(r.thumbnailUrl);assert.equal(coverResponse.status,200);
      const cover=Buffer.from(await coverResponse.arrayBuffer()),image=await sharp(cover).metadata();
      assert.equal(image.format,'jpeg');assert.equal(image.width,480);
      await writeFile(new URL(folder+'/thumbnails/'+record.id+'.jpg',root),cover);
     }else pendingCovers.push(r.scene);
     checked.push({scene:r.scene,kind:r.kind,sha256:r.sha256,bytes:live.length,sourceAssetId:r.sourceAssetId,thumbnail:!!r.thumbnailUrl});
     if(checked.length%100===0)console.log(JSON.stringify({verified:checked.length,pendingCovers:pendingCovers.length}));
    }catch(e){failures.push({scene:r.scene,error:e.message});}
   }
  }));
  await save(new URL(folder+'/manifest.json',root),{updatedAt:new Date().toISOString(),count:records.length,resources:records});
 }
 const report={status:failures.length?'failed':publicResources.length<2000||pendingCovers.length?'in-progress':'passed',checkedAt:new Date().toISOString(),
  public:publicResources.length,distinctPublicHashes:new Set(publicResources.map(r=>r.sha256)).size,
  models:publicResources.filter(r=>r.kind==='model').length,panoramas:publicResources.filter(r=>r.kind==='panorama').length,
  publicOrgans:publicResources.filter(r=>r.category==='人体器官').length,
  bySource:Object.fromEntries([...new Set(publicResources.map(r=>r.sourceName))].map(s=>[s,publicResources.filter(r=>r.sourceName===s).length])),
  baselineMetadataCompared:originals.length,privateOriginalsProtected,packs,newAssetsVerified:checked.length,bytesVerified:checked.reduce((n,r)=>n+r.bytes,0),pendingCovers,failures};
 if(report.distinctPublicHashes<2000&&report.status==='passed')report.status='in-progress';
 await save(new URL('verification.json',root),report);
 await save(new URL('verified-assets.json',root),checked);
 console.log(JSON.stringify(report,null,2));
 if(report.status!=='passed')process.exitCode=1;
}finally{await admin.send('/auth/logout',{});}
