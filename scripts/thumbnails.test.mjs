import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {safeThumbnailUrl} from '../portal/thumbnails.mjs';
test('thumbnail URLs stay within the original scene and known image file',()=>{
  const r={scene:'lr-123',thumbnailUrl:'/scenes/lr-123/scene-image-thumb.jpg'};
  assert.equal(safeThumbnailUrl(r),r.thumbnailUrl);
  assert.equal(safeThumbnailUrl({...r,thumbnailUrl:r.thumbnailUrl+'?v=2'}),r.thumbnailUrl+'?v=2');
  for(const thumbnailUrl of [null,'https://evil.test/x.jpg','data:text/html,x','/scenes/other/scene-image-thumb.jpg','/scenes/lr-123/../../secret','/scenes/lr-123/model.glb'])assert.equal(safeThumbnailUrl({...r,thumbnailUrl}),null);
});
test('thumbnails reserve layout and do not repeat text labels',async()=>{
  const css=await readFile(new URL('../portal/style.css',import.meta.url),'utf8');
  const module=await readFile(new URL('../portal/thumbnails.mjs',import.meta.url),'utf8');
  assert.match(css,/\.resource-thumbnail \{[^}]*width: 76px; height: 64px/);
  assert.match(css,/\[data-kind=model\] img \{ object-fit: contain/);
  assert.match(module,/loading='lazy'/);assert.match(module,/decoding='async'/);assert.match(module,/image\.onerror/);
  assert.doesNotMatch(module,/textContent.*(?:3D|360)/);
});
test('screenshot generation is lazy and disposes GPU resources',async()=>{
  const app=await readFile(new URL('../portal/app.ts',import.meta.url),'utf8');
  const render=await readFile(new URL('../portal/thumbnail-renderer.ts',import.meta.url),'utf8');
  assert.match(app,/resource\.canEdit&&resource\.kind==='model'&&!resource\.thumbnailUrl/);
  assert.match(app,/await import\(rendererPath\)/);assert.match(render,/disposeModel\(gltf\.scene\)/);assert.match(render,/forceContextLoss/);
  assert.match(render,/setURLModifier/);assert.match(render,/AbortSignal\.timeout/);
});
