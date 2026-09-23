import test from 'node:test';
import assert from 'node:assert/strict';
import {packGltf} from './pack-gltf.mjs';
const doc={asset:{version:'2.0'},meshes:[{primitives:[]}],scenes:[{}],
  buffers:[{uri:'mesh.bin',byteLength:3},{uri:'other.bin',byteLength:4}],
  bufferViews:[{buffer:0,byteLength:3},{buffer:1,byteLength:4}],images:[{uri:'albedo.jpg'}]};
const resources={'mesh.bin':Buffer.from([1,2,3]),'other.bin':Buffer.from([4,5,6,7]),'albedo.jpg':Buffer.from([255,216,255])};
test('GLB packing preserves bytes and offsets, embeds textures and leaves input untouched',()=>{
  const bytes=packGltf(doc,resources),size=bytes.readUInt32LE(12),json=JSON.parse(bytes.toString('utf8',20,20+size));
  assert.equal(bytes.readUInt32LE(8),bytes.length);assert.equal(json.bufferViews[1].byteOffset,4);
  assert.equal(json.images[0].uri,undefined);assert.equal(json.images[0].bufferView,2);
  assert.deepEqual([...bytes.subarray(28+size,28+size+7)],[1,2,3,0,4,5,6]);
  assert.equal(doc.images[0].uri,'albedo.jpg');
});
test('missing, unverified and invalid buffers are rejected',()=>{
  assert.throws(()=>packGltf(doc,{}));
  assert.throws(()=>packGltf({...doc,buffers:[{uri:'https://untrusted.invalid/a',byteLength:3}]},resources));
  assert.throws(()=>packGltf({...doc,bufferViews:[{buffer:0,byteLength:99}]},resources));
});
