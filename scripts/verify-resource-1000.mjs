import assert from 'node:assert/strict';
import {readFile,writeFile,readdir,mkdir,rename,realpath,stat} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Client,accounts} from './local-api.mjs';
import {runtimeUrl,sourceUrl,runtimeDependency} from './runtime-paths.mjs';
const sharp=runtimeDependency('sharp');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const {validateGlb}=await import(runtimeUrl('build/server/learning/validation.js'));
// Both collectors write completion reports only after all their workers have stopped.
for(const file of ['resource-1000-import.json','models-1000-import.json']){
  const completed=JSON.parse(await readFile(runtimeUrl('output/'+file),'utf8'));
  assert(completed.updatedAt&&completed.resources.length,'Wait for both collection jobs to finish');
}
const admin=new Client(),anonymous=new Client();await admin.login((await accounts()).admin);
const resources=await admin.resources(),published=await anonymous.resources();
const baseline=JSON.parse(await readFile(runtimeUrl('output/resource-1000-baseline.json'),'utf8'));
const oldNotes=JSON.parse(await readFile(runtimeUrl('output/pre-restart-state.json'),'utf8'));
const byScene=new Map(resources.map(r=>[r.scene,r]));
const failures=[],checked=[],packReports=[];
const minimum=1000;
assert(published.length>=minimum,'Public catalog has not reached 1000');
assert(new Set(published.map(r=>r.sha256)).size>=minimum,'Fewer than 1000 distinct public binary assets');
for(const old of baseline.resources){
  const current=byScene.get(old.scene);assert(current,'Original resource missing');
  assert.deepEqual(current,old,'Original resource metadata or publication changed: '+old.scene);
  const response=await admin.request(old.assetUrl);assert.equal(response.status,200);
  const digest=createHash('sha256');for await(const chunk of response.body)digest.update(chunk);
  assert.equal(digest.digest('hex'),old.sha256,'Original binary changed: '+old.scene);
}
for(const old of oldNotes){
  const current=await admin.json('/learn/api/resources/'+old.scene);
  assert.deepEqual(current.notes,old.notes,'Original notes changed: '+old.scene);
}
for(const [folder,delivery] of [['resource-1000','resources-20260921'],['models-1000','models-20260921']]){
  await mkdir(sourceUrl('deliverables/'+delivery+'/thumbnails/'),{recursive:true});
  const records=[];
  for(const name of await readdir(runtimeUrl('samples/'+folder+'/records/'))){
    if(!name.endsWith('.json'))continue;
    const record=JSON.parse(await readFile(runtimeUrl('samples/'+folder+'/records/'+name),'utf8'));
    if(record.phase==='published'&&byScene.get(record.scene)?.published)records.push(record);
  }
  const report={folder,count:records.length,resources:records};packReports.push(report);
  let index=0;
  await Promise.all(Array.from({length:3},async()=>{
    while(index<records.length){
      const record=records[index++],current=byScene.get(record.scene);
      try{
        assert.equal(current.sha256,record.sha256);assert.equal(current.license,'CC0-1.0');
        assert.equal(current.sourceUrl,record.metadata.sourceUrl);assert.equal(current.creator,record.metadata.creator);
        assert(current.thumbnailUrl,'Missing real thumbnail');
        const asset=await anonymous.request(current.assetUrl);assert.equal(asset.status,200);
        const bytes=Buffer.from(await asset.arrayBuffer());assert.equal(hash(bytes),record.sha256);
        const formal=await readFile(sourceUrl('deliverables/'+delivery+'/'+record.file));
        assert.equal(hash(formal),record.sha256,'Z delivery differs from live asset');
        if(current.kind==='model')validateGlb(bytes);
        else{const meta=await sharp(bytes).metadata();assert.equal(meta.width,2048);assert.equal(meta.height,1024);}
        const cover=await anonymous.request(current.thumbnailUrl);assert.equal(cover.status,200);
        const coverBytes=Buffer.from(await cover.arrayBuffer());
        const image=await sharp(coverBytes).metadata();
        assert.equal(image.width,480);assert.equal(image.format,'jpeg');
        record.thumbnailFile='thumbnails/'+record.id+'.jpg';
        await writeFile(sourceUrl('deliverables/'+delivery+'/'+record.thumbnailFile),coverBytes);
        const detail=await anonymous.json('/learn/api/resources/'+current.scene);
        assert.deepEqual(detail.notes.entries,record.notes);
        const provenance=await admin.json('/scenes/'+current.scene+'/upstream-metadata.json');
        assert.equal(provenance.packId,record.packId);assert.equal(provenance.evidenceUrl,'https://polyhaven.com/license');
        checked.push({scene:current.scene,sha256:current.sha256,kind:current.kind,bytes:bytes.length,sourceAssetId:current.sourceAssetId});
        if(checked.length%100===0)console.log(JSON.stringify({verifiedNew:checked.length}));
      }catch(error){failures.push({scene:record.scene,id:record.id,reason:error.message});}
    }
  }));
  // Keep rejected task-generated files recoverable and separate from approved assets.
  assert.deepEqual((await admin.resources()).map(r=>r.scene).sort(),resources.map(r=>r.scene).sort(),'Catalog changed during verification; retry after collection completes');
  const accepted=new Set(records.map(r=>r.file.split('/').at(-1))),excluded=[];
  const formalRoot=await realpath(sourceUrl('deliverables/'+delivery+'/'));
  const assetsRoot=await realpath(sourceUrl('deliverables/'+delivery+'/assets/'));
  assert.equal(path.dirname(assetsRoot),formalRoot);
  await mkdir(sourceUrl('deliverables/'+delivery+'/excluded/'),{recursive:true});
  const excludedRoot=await realpath(sourceUrl('deliverables/'+delivery+'/excluded/'));
  assert.equal(path.dirname(excludedRoot),formalRoot);
  for(const file of await readdir(sourceUrl('deliverables/'+delivery+'/assets/'))){
    if(accepted.has(file))continue;
    assert(/^[a-zA-Z0-9_-]+\.(glb|jpg)$/.test(file));
    const from=await realpath(sourceUrl('deliverables/'+delivery+'/assets/'+file)),to=path.join(excludedRoot,file);
    assert.equal(path.dirname(from),assetsRoot);assert.equal(path.dirname(to),excludedRoot);
    const exists=await stat(to).then(()=>true,e=>{if(e.code!=='ENOENT')throw e;return false;});
    assert(!exists,'Do not overwrite excluded evidence');
    await rename(from,to);excluded.push(file);
  }
  // Cumulative manifest is rebuilt from per-asset journals, so reruns never erase past imports.
  await writeFile(sourceUrl('deliverables/'+delivery+'/manifest.json'),JSON.stringify({
    packId:records[0]?.packId,verifiedAt:new Date().toISOString(),count:records.length,
    excludedFiles:await readdir(excludedRoot),resources:records,
  },null,2)+'\n','utf8');
}
for(const old of baseline.resources.filter(r=>!r.published)){
  const result=await anonymous.request(old.assetUrl);assert([401,403,404].includes(result.status),'Private original became public');
  await result.body?.cancel();
}
const report={status:failures.length?'failed':'passed',checkedAt:new Date().toISOString(),total:resources.length,
  public:published.length,distinctPublicHashes:new Set(published.map(r=>r.sha256)).size,
  models:published.filter(r=>r.kind==='model').length,panoramas:published.filter(r=>r.kind==='panorama').length,
  publicOrgans:published.filter(r=>r.category==='人体器官').length,
  originalMetadataPreserved:baseline.resources.length,originalFilesVerified:baseline.resources.length,originalNotesPreserved:oldNotes.length,
  newAssetsVerified:checked.length,bytesVerified:checked.reduce((n,r)=>n+r.bytes,0),
  packs:packReports.map(({folder,count})=>({folder,count})),failures};
await mkdir(sourceUrl('deliverables/resources-20260921/'),{recursive:true});
await writeFile(runtimeUrl('output/resource-1000-verification.json'),JSON.stringify(report,null,2)+'\n','utf8');
await writeFile(sourceUrl('deliverables/resources-20260921/verification.json'),JSON.stringify(report,null,2)+'\n','utf8');
console.log(JSON.stringify(report,null,2));
if(failures.length)process.exitCode=1;
