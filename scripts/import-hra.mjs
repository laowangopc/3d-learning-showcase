import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Client, accounts } from './local-api.mjs';
import { runtimeUrl, sourceUrl } from './runtime-paths.mjs';

const manifest=JSON.parse(await readFile(sourceUrl('samples/hra-manifest.json'),'utf8'));
const client=new Client();await client.login((await accounts()).admin);
const existing=await client.resources();
const results=[], failures=[];
await mkdir(runtimeUrl('output/'),{recursive:true});
for(const sample of manifest.samples) {
  let scene;
  try {
    if(sample.metadata.license!=='CC-BY-4.0'||!sample.sourceMetadata?.license?.includes('https://creativecommons.org/licenses/by/4.0/'))throw new Error('Missing per-object license');
    const bytes=await readFile(runtimeUrl(`samples/${sample.file}`));
    const hash=createHash('sha256').update(bytes).digest('hex');
    if(hash!==sample.sha256 || hash!==sample.metadata.sourceSha256)throw new Error('Asset hash mismatch');
    const found=existing.find(r=>r.sourceAssetId===sample.metadata.sourceAssetId&&r.sourceName===sample.metadata.sourceName&&r.sha256===hash);
    if(found){
      // Do not republish a resource an administrator subsequently made private.
      results.push({key:sample.key,scene:found.scene,sha256:hash,published:found.published,preserved:true});
      console.log(`Preserved: ${sample.metadata.title}`);continue;
    }
    ({scene}=await client.upload(bytes,sample.metadata));
    const prefix=`/learn/api/resources/${scene}`;
    const detail=await client.json(prefix);
    await client.send(`${prefix}/notes`,{expectedVersion:detail.notes.version,entries:sample.notes},'PUT');
    // Keep original provenance with the downloadable scene, not just in the local import ledger.
    const evidence=await client.request(`/scenes/${scene}/upstream-metadata.json`,{method:'PUT',
      headers:{'Content-Type':'application/json'},body:JSON.stringify({sourceRevision:manifest.sourceRevision,
        evidenceUrl:sample.evidenceUrl,metadataSha256:sample.upstreamMetadataSha256,metadata:sample.sourceMetadata},null,2)});
    if(!evidence.ok)throw new Error(`Provenance attachment returned ${evidence.status}`);
    await client.send(`${prefix}/publication`,{published:true,redistributionConfirmed:true,evidenceUrl:sample.evidenceUrl,note:sample.reviewNote});
    results.push({key:sample.key,scene,sha256:hash,published:true});
    existing.push({...sample.metadata,scene,sha256:hash,published:true});
    console.log(`Published ${results.length}/${manifest.samples.length}: ${sample.metadata.title}`);
  } catch(e) {failures.push({key:sample.key,scene,reason:e.message});console.error(`Failed ${sample.key}: ${e.message}`);}
  await writeFile(runtimeUrl('output/hra-import-results.json'),JSON.stringify({updatedAt:new Date().toISOString(),resources:results,failures},null,2),'utf8');
}
await writeFile(runtimeUrl('output/hra-import-results.json'),JSON.stringify({updatedAt:new Date().toISOString(),resources:results,failures},null,2),'utf8');
console.log(JSON.stringify({succeeded:results.length,failed:failures.length}));
if(failures.length)process.exitCode=1;
