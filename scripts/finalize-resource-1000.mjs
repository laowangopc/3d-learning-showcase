import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {runtimeUrl,sourceUrl} from './runtime-paths.mjs';
const json=async url=>JSON.parse(await readFile(url,'utf8'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const verified=await json(runtimeUrl('output/resource-1000-verification.json'));
assert.equal(verified.status,'passed');assert(verified.public>=1000&&verified.distinctPublicHashes>=1000);
const log=await readFile(runtimeUrl('output/resource-1000-browser.log'),'utf8');
const match=log.match(/### Result\s*(\{[^\r\n]+\})/);assert(match,'Browser result missing');
const browser=JSON.parse(match[1]);assert.equal(browser.status,'passed');assert.equal(browser.publicResources,verified.public);
const tests=await readFile(runtimeUrl('output/resource-1000-unit.tap'),'utf8');
assert(/^# fail 0$/m.test(tests));assert(Number(tests.match(/^# pass (\d+)$/m)?.[1])>=38);
const root=sourceUrl('deliverables/resources-20260921/');await mkdir(new URL('evidence/',root),{recursive:true});
await writeFile(new URL('evidence/browser.json',root),JSON.stringify(browser,null,2)+'\n','utf8');
const receipt=[];
for(const [from,name] of [['output/resource-1000-unit.tap','unit-tests.tap'],
  ...['model','organs','panorama','mobile'].map(type=>['output/playwright/resources1000-'+type+'.png',type+'.png'])]){
  const source=runtimeUrl(from),destination=new URL('evidence/'+name,root);
  await copyFile(source,destination);const bytes=await readFile(source);
  assert.equal(hash(await readFile(destination)),hash(bytes));receipt.push({file:'evidence/'+name,bytes:bytes.length,sha256:hash(bytes)});
}
for(const file of ['evidence/browser.json','verification.json','manifest.json']){
  const bytes=await readFile(new URL(file,root));receipt.push({file,bytes:bytes.length,sha256:hash(bytes)});
}
const exclusions=[];
for(const [folder,delivery,report] of [['resource-1000','resources-20260921','resource-1000-import.json'],['models-1000','models-20260921','models-1000-import.json']]){
  const imported=await json(runtimeUrl('output/'+report));
  exclusions.push(...imported.failures.map(entry=>({...entry,kind:folder==='models-1000'?'model':'panorama',sourceUrl:'https://polyhaven.com/a/'+encodeURIComponent(entry.id),counted:false})));
  const manifest=await json(sourceUrl('deliverables/'+delivery+'/manifest.json'));
  for(const file of manifest.excludedFiles??[]){
    const id=file.replace(/\.(jpg|glb)$/,'');
    const record=await json(runtimeUrl('samples/'+folder+'/records/'+id+'.json'));
    await writeFile(sourceUrl('deliverables/'+delivery+'/excluded/'+id+'.json'),JSON.stringify({...record,counted:false},null,2)+'\n','utf8');
  }
}
await writeFile(new URL('exclusions.json',root),JSON.stringify(exclusions,null,2)+'\n','utf8');
const modelManifest=await readFile(sourceUrl('deliverables/models-20260921/manifest.json'));
receipt.push({file:'../models-20260921/manifest.json',bytes:modelManifest.length,sha256:hash(modelManifest)});
await writeFile(new URL('receipt.json',root),JSON.stringify({createdAt:new Date().toISOString(),public:verified.public,
  distinctPublicHashes:verified.distinctPublicHashes,newAssets:verified.newAssetsVerified,files:receipt,
  note:'Actual assets and thumbnails are stored beside the manifests on verified Z/UNC storage. Private sessions, account files and database backups are not included. Y synchronization is not asserted.'},null,2)+'\n','utf8');
console.log(JSON.stringify({status:'passed',public:verified.public,newAssets:verified.newAssetsVerified,browserChecks:browser.checks.length,evidenceFiles:receipt.length,excluded:exclusions.length}));
