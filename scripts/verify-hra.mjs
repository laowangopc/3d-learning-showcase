import assert from 'node:assert/strict';
import { readFile,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Client } from './local-api.mjs';
import { sourceUrl,runtimeUrl,runtimeDependency } from './runtime-paths.mjs';
const manifest=JSON.parse(await readFile(sourceUrl('samples/hra-manifest.json'),'utf8'));
const anon=new Client(), resources=await anon.resources(), results=[];
for(const sample of manifest.samples) {
  const found=resources.find(r=>r.sourceAssetId===sample.metadata.sourceAssetId&&r.sourceName===sample.metadata.sourceName&&r.sha256===sample.sha256);
  assert.ok(found,`Anonymous catalog is missing ${sample.key}`);
  const detail=await anon.json(`/learn/api/resources/${found.scene}`);
  assert.equal(detail.published,true);
  assert.equal(detail.license,'CC-BY-4.0');
  assert.equal(detail.category,'人体器官');
  assert.equal(detail.canEdit,false);
  assert.equal(detail.rightsReview.evidenceUrl,sample.evidenceUrl);
  const provenance=await anon.json(`/scenes/${found.scene}/upstream-metadata.json`);
  assert.equal(provenance.metadataSha256,sample.upstreamMetadataSha256);
  assert.equal(provenance.metadata.citation,sample.sourceMetadata.citation);
  const response=await anon.request(detail.assetUrl);assert.equal(response.status,200);
  const bytes=Buffer.from(await response.arrayBuffer());
  assert.equal(createHash('sha256').update(bytes).digest('hex'),sample.sha256);
  assert.ok(detail.properties.numFaces>0&&detail.properties.numFaces<=2000000);
  results.push({key:sample.key,scene:found.scene,title:detail.title,bytes:bytes.length,faces:detail.properties.numFaces,anonymousRead:true});
  console.log(`Verified ${results.length}/${manifest.samples.length}: ${detail.title}`);
}
const heart=results.find(r=>r.key==='hra-heart-male')??results.find(r=>r.title.startsWith('心脏'));
const zipResponse=await anon.request(`/scenes/${heart.scene}`,{headers:{Accept:'application/zip'}});
assert.equal(zipResponse.status,200);
const {unzipSync}=runtimeDependency('fflate');
const zip=unzipSync(new Uint8Array(await zipResponse.arrayBuffer()));
for(const filename of ['model.glb','resource.json','upstream-metadata.json','notes.json'])assert.ok(Object.keys(zip).some(n=>n.endsWith(filename)),`ZIP missing ${filename}`);
const report={checkedAt:new Date().toISOString(),publicTotal:resources.length,publicModels:resources.filter(r=>r.kind==='model').length,
  publicPanoramas:resources.filter(r=>r.kind==='panorama').length,publicAnatomy:results.length,
  bytesVerified:results.reduce((sum,r)=>sum+r.bytes,0),heartUrl:`http://127.0.0.1:3080/learn/#${heart.scene}`,
  exportProvenanceVerified:true,resources:results};
await writeFile(runtimeUrl('output/hra-verification.json'),JSON.stringify(report,null,2)+'\n','utf8');
console.log(JSON.stringify({...report,resources:undefined},null,2));
