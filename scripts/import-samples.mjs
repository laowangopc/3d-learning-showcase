import { runtimeUrl, sourceUrl } from './runtime-paths.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Client,accounts} from './local-api.mjs';
const manifest=JSON.parse(await readFile(sourceUrl('samples/manifest.json'),'utf8'));
const client=new Client();await client.login((await accounts()).admin);
const existing=await client.resources();
const results=[];
for(const sample of manifest.samples){
  const bytes=await readFile(runtimeUrl(`samples/${sample.file}`));
  const hash=createHash('sha256').update(bytes).digest('hex');
  const found=existing.find(r=>r.sourceAssetId===sample.metadata.sourceAssetId&&r.sourceName===sample.metadata.sourceName&&r.sha256===hash);
  if(found){
    // Metadata-only refresh of our exact seeded object; never reset annotations or visibility.
    if(found.sourceSha256!==sample.metadata.sourceSha256){
      const stored=await client.json(`/scenes/${found.scene}/resource.json`);
      const response=await client.request(`/scenes/${found.scene}/resource.json`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...stored,sourceSha256:sample.metadata.sourceSha256,modifications:sample.metadata.modifications})});
      if(!response.ok)throw new Error(`Source record update returned ${response.status}`);
    }
    console.log(`Preserved existing resource: ${sample.metadata.title}`);results.push({key:sample.key,scene:found.scene,sha256:hash});continue;
  }
  const {scene}=await client.upload(bytes,sample.metadata);
  const prefix=`/learn/api/resources/${scene}`;
  const detail=await client.json(prefix);
  await client.send(`${prefix}/notes`,{expectedVersion:detail.notes.version,entries:sample.notes},'PUT');
  await client.send(`${prefix}/publication`,{published:true,redistributionConfirmed:true,evidenceUrl:sample.evidenceUrl,note:sample.reviewNote});
  results.push({key:sample.key,scene,sha256:hash});console.log(`Imported and published: ${sample.metadata.title}`);
}
await mkdir(runtimeUrl('output/'),{recursive:true});
await writeFile(runtimeUrl('output/seed-results.json'),JSON.stringify({importedAt:new Date().toISOString(),resources:results},null,2),'utf8');
