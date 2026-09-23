import { sourceRoot, runtimeRoot, dependencyRoot, sourcePath, runtimePath, resolveDependency } from './runtime-paths.mjs';
console.log(JSON.stringify({sourceRoot,runtimeRoot,dependencyRoot,
  inputs:[sourcePath('portal/app.ts'),sourcePath('ecorpus/source/server/learning/validation.ts'),sourcePath('ecorpus/source/server/migrations/010-learning.sql')],
  outputs:[runtimePath('build'),runtimePath('output'),runtimePath('samples')],
  privatePaths:[runtimePath('.env'),runtimePath('secrets/accounts.json')],
  dependencies:Object.fromEntries(['esbuild','sharp','fflate','yaml','@photo-sphere-viewer/core'].map(name=>[name,resolveDependency(name)]))},null,2));
