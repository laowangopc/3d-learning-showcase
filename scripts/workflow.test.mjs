import test from 'node:test';
import assert from 'node:assert/strict';
import {runtimeUrl} from './runtime-paths.mjs';
const {reviewState,reviewTransition}=await import(runtimeUrl('build/server/learning/review-state.js'));
test('legacy private defaults to draft and public ACL remains authoritative',()=>{
  assert.equal(reviewState(false),'draft');assert.equal(reviewState(true),'published');
  assert.equal(reviewState(false,{state:'published'}),'draft');assert.equal(reviewState(false,{state:'changes'}),'changes');
});
test('clear rights and affirmative declaration are required to submit',()=>{
  assert.throws(()=>reviewTransition('draft','submit',{license:'unknown',confirmed:true},false));
  assert.throws(()=>reviewTransition('draft','submit',{license:'CC0-1.0'},false));
  assert.deepEqual(reviewTransition('draft','submit',{license:'CC0-1.0',confirmed:true},false),{state:'pending',message:''});
});
test('pending and published resources cannot be resubmitted',()=>{
  for(const state of ['pending','published'])assert.throws(()=>reviewTransition(state,'submit',{license:'CC0-1.0',confirmed:true},false));
});
test('only pending applications can be withdrawn',()=>{
  assert.deepEqual(reviewTransition('pending','withdraw',{},false),{state:'draft',message:''});
  for(const state of ['draft','changes','published'])assert.throws(()=>reviewTransition(state,'withdraw',{},false));
});
test('rejection is admin-only with bounded nonempty feedback and pending state',()=>{
  assert.throws(()=>reviewTransition('pending','reject',{message:'补充许可'},false));
  for(const message of ['', '字'.repeat(1001)])assert.throws(()=>reviewTransition('pending','reject',{message},true));
  assert.throws(()=>reviewTransition('published','reject',{message:'补充许可'},true));
  assert.deepEqual(reviewTransition('pending','reject',{message:'请补充许可。'},true),{state:'changes',message:'请补充许可。'});
});
test('resubmission clears previous feedback without losing audit history',()=>{
  assert.deepEqual(reviewTransition('changes','submit',{license:'permission',confirmed:true},false),{state:'pending',message:''});
});
test('unsupported transition rejected',()=>assert.throws(()=>reviewTransition('draft','approve',{},true)));
