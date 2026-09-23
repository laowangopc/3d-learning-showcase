import test from 'node:test';
import assert from 'node:assert/strict';
import {modelTopic} from './model-topic.mjs';
test('wooden furniture is not misclassified as a natural specimen',()=>{
  assert.equal(modelTopic({category:'Furniture/Seating/Chairs',tags:['wood','natural']})[0],'器物与家具');
  assert.equal(modelTopic({category:'Nature/Rocks & Stone/Boulders'})[0],'自然标本');
});
test('unrecognized taxonomy uses a neutral category',()=>{
  assert.equal(modelTopic({name:'unknown',tags:['wood']})[0],'日常器物');
});
