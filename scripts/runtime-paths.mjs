import { mkdirSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

export const sourceRoot = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
function directory(value, name) {
  if (!value || !path.isAbsolute(value)) throw new Error(`${name} must be an absolute path`);
  mkdirSync(value, { recursive: true });
  return realpathSync(value);
}
export const runtimeRoot = directory(process.env.SHOWCASE_RUNTIME_ROOT || process.env.ANATOMY_RUNTIME_ROOT || path.join(os.tmpdir(), '3d-learning-showcase'), 'SHOWCASE_RUNTIME_ROOT');
if (runtimeRoot === sourceRoot || runtimeRoot.startsWith(sourceRoot + path.sep)) {
  throw new Error('SHOWCASE_RUNTIME_ROOT must be outside the source tree');
}
export const dependencyRoot = directory(process.env.SHOWCASE_DEPS_ROOT || process.env.ANATOMY_DEPS_ROOT || path.join(sourceRoot, 'node_modules'), 'SHOWCASE_DEPS_ROOT');
export const sourcePath = (...parts) => path.join(sourceRoot, ...parts);
export const runtimePath = (...parts) => path.join(runtimeRoot, ...parts);
export const sourceUrl = relative => pathToFileURL(sourcePath(relative));
export function runtimeUrl(relative = '') {
  return pathToFileURL(runtimePath(relative) + ((!relative || /[\\/]$/.test(relative)) ? path.sep : ''));
}
const dependencyRequire = createRequire(path.join(dependencyRoot, '..', '__showcase_dependency_anchor__.cjs'));
export function resolveDependency(name) {
  const file = dependencyRequire.resolve(name);
  const relative = path.relative(dependencyRoot, realpathSync(file));
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Dependency is outside the explicit dependency directory: ${name}`);
  return file;
}
export function runtimeDependency(name) { return dependencyRequire(resolveDependency(name)); }
export function composeArguments(...command) {
  return ['compose', '-p', '3d-learning-showcase', '--project-directory', runtimeRoot,
    '--env-file', runtimePath('.env'), '-f', sourcePath('compose.yaml'), ...command];
}
