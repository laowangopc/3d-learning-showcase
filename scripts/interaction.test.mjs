import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {scrollBehavior,isSearchShortcut,licenseLabel,requestError} from '../portal/interaction.mjs';

test('keyboard and reduced-motion scrolling never animate',()=>{
  assert.equal(scrollBehavior(),'smooth');
  assert.equal(scrollBehavior({keyboard:true}),'instant');
  assert.equal(scrollBehavior({reducedMotion:true}),'instant');
  assert.equal(scrollBehavior({keyboard:true,reducedMotion:true}),'instant');
});
test('search shortcut respects text entry, IME, modifiers and dialogs',()=>{
  assert.equal(isSearchShortcut({key:'/'}),true);
  for(const modifier of ['ctrlKey','metaKey','altKey','isComposing'])assert.equal(isSearchShortcut({key:'/',[modifier]:true}),false);
  assert.equal(isSearchShortcut({key:'/'},true),false);
  assert.equal(isSearchShortcut({key:'/'},false,true),false);
  assert.equal(isSearchShortcut({key:'a'}),false);
});
test('license labels retain conditions without implying blanket authorization',()=>{
  assert.equal(licenseLabel('permission'),'按来源条款使用');
  assert.equal(licenseLabel('unknown'),'待核对');
  assert.equal(licenseLabel('CC-BY-4.0'),'CC-BY-4.0');
});
test('request failures provide a next step, never a raw API body',()=>{
  for(const code of [400,401,403,404,409,413,422,429,500,502])assert.match(requestError(code),/请/);
  assert.match(requestError(409),/保留.*草稿/);
});
test('motion styles are bounded and preserve keyboard and touch handling',async()=>{
  const css=await readFile(new URL('../portal/style.css',import.meta.url),'utf8');
  assert.doesNotMatch(css,/transition:\s*all|scale\(0\)|\bease-in\b/);
  assert.match(css,/prefers-reduced-motion/);
  assert.match(css,/hover: hover.*pointer: fine/);
  assert.match(css,/html\[data-input=keyboard\]/);
  assert.match(css,/--press-duration: 140ms/);
  assert.match(css,/--dialog-duration: 180ms/);
});
test('ordinary interface copy omits engineering and acceptance terminology',async()=>{
  const html=await readFile(new URL('../portal/index.html',import.meta.url),'utf8');
  assert.doesNotMatch(html.replace(/<[^>]*>/g,''),/幂等|服务端签发|验收|校验哈希|版本号冲突|本地教学验证版|permission/);
});
