import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { sourceRoot, runtimeRoot, dependencyRoot, sourcePath, runtimePath, runtimeDependency } from './runtime-paths.mjs';
const { build } = runtimeDependency('esbuild');
await mkdir(runtimePath('build/portal'), { recursive: true });
await mkdir(runtimePath('build/migrations'), { recursive: true });
const server = await build({
  absWorkingDir: sourceRoot,
  entryPoints: ['ecorpus/source/server/routes/index.ts', 'ecorpus/source/server/vfs/Scenes.ts', 'ecorpus/source/server/auth/UserManager.ts',
    'ecorpus/source/server/learning/index.ts', 'ecorpus/source/server/learning/validation.ts',
    'ecorpus/source/server/learning/store.ts', 'ecorpus/source/server/learning/shared.ts',
    'ecorpus/source/server/learning/accounts.ts', 'ecorpus/source/server/learning/management.ts',
    'ecorpus/source/server/learning/workflow.ts', 'ecorpus/source/server/learning/review-state.ts'],
  outbase: sourcePath('ecorpus/source/server'), outdir: runtimePath('build/server'),
  platform: 'node', target: 'node22', format: 'esm', bundle: false, sourcemap: true, metafile: true
});
const portal = await build({
  absWorkingDir: sourceRoot, nodePaths: [dependencyRoot],
  entryPoints: ['portal/app.ts'], outdir: runtimePath('build/portal'),
  bundle: true, format: 'esm', target: 'es2022', minify: false, sourcemap: true, metafile: true,
  loader: { '.svg': 'dataurl', '.png': 'dataurl' }
});
const thumbnails = await build({
  absWorkingDir: sourceRoot, nodePaths: [dependencyRoot], entryPoints:['portal/thumbnail-renderer.ts'],
  outdir:runtimePath('build/portal'),bundle:true,format:'esm',target:'es2022',metafile:true
});
const thumbnailVendorInputs=[];
for(const [folder,names] of Object.entries({draco:['draco_wasm_wrapper.js','draco_decoder.wasm','draco_decoder.js'],basis:['basis_transcoder.js','basis_transcoder.wasm']})){
  await mkdir(runtimePath(`build/portal/thumbnail-vendor/${folder}`),{recursive:true});
  for(const name of names){const file=path.join(dependencyRoot,'three/examples/jsm/libs',folder,folder==='draco'?'gltf':'',name);thumbnailVendorInputs.push(file);await copyFile(file,runtimePath(`build/portal/thumbnail-vendor/${folder}/${name}`));}
}
thumbnailVendorInputs.push(path.join(dependencyRoot,'three/LICENSE'));
await copyFile(path.join(dependencyRoot,'three/LICENSE'),runtimePath('build/portal/thumbnail-vendor/LICENSE.three.txt'));
const copies = [
  ['portal/index.html', 'build/portal/index.html'], ['portal/style.css', 'build/portal/style.css'],
  ['portal/model.html', 'build/portal/model.html'], ['portal/model.js', 'build/portal/model.js'],
  ['ecorpus/source/server/migrations/010-learning.sql', 'build/migrations/010-learning.sql'],
  ['ecorpus/source/server/migrations/011-learning-release.sql', 'build/migrations/011-learning-release.sql'],
  ['ecorpus/source/server/migrations/012-learning-workflow.sql', 'build/migrations/012-learning-workflow.sql'],
  ['ecorpus/source/server/migrations/013-learning-disabled-accounts.sql', 'build/migrations/013-learning-disabled-accounts.sql'],
  ['Dockerfile', 'build/Dockerfile'], ['.dockerignore', 'build/.dockerignore']
];
for (const [from,to] of copies) await copyFile(sourcePath(from), runtimePath(to));
const inputs = [...new Set([...Object.keys(server.metafile.inputs), ...Object.keys(portal.metafile.inputs), ...Object.keys(thumbnails.metafile.inputs), ...thumbnailVendorInputs, ...copies.map(([from])=>from)])].sort();
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const inputManifest = [];
for (const input of inputs) {
  const file = path.resolve(sourceRoot,input);
  const bytes = await readFile(file);
  const relative = path.relative(sourceRoot,file);
  const kind = relative.startsWith('..') || path.isAbsolute(relative) ? 'dependency' : 'source';
  inputManifest.push({path:file,size:bytes.length,sha256:sha256(bytes),kind});
}
await writeFile(runtimePath('build/source-manifest.json'),JSON.stringify({sourceRoot,runtimeRoot,dependencyRoot,inputs:inputManifest},null,2),'utf8');
console.log(`Built source into ${runtimePath('build')}; no container was changed.`);
