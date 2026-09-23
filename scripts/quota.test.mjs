import test from 'node:test';
import assert from 'node:assert/strict';
import {runtimeUrl} from './runtime-paths.mjs';
const {resourceQuota}=await import(runtimeUrl('build/server/learning/validation.js'));
test('curated capacity does not expand ordinary user quota',()=>{
  const env={LEARNING_CURATED_RESOURCE_LIMIT:'1500',LEARNING_CURATED_STORAGE_BYTES:'4294967296'};
  assert.deepEqual(resourceQuota(false,env),{maxResources:200,maxBytes:2147483648});
  assert.deepEqual(resourceQuota(true,env),{maxResources:1500,maxBytes:4294967296});
});
test('invalid limits cannot disable quotas',()=>{
  for(const value of ['0','-1','Infinity','NaN','1.5','']){
    assert.deepEqual(resourceQuota(true,{LEARNING_CURATED_RESOURCE_LIMIT:value,LEARNING_CURATED_STORAGE_BYTES:value}),{maxResources:200,maxBytes:2147483648});
  }
});
