// Node has no import map, so map the bare `three` specifier the game uses in
// the browser onto the vendored module. Loaded with `node --import`.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

const three = pathToFileURL(new URL('../vendor/three.module.js', import.meta.url).pathname).href;
register(`data:text/javascript,
export async function resolve(specifier, context, next) {
  if (specifier === 'three') return { url: ${JSON.stringify(three)}, shortCircuit: true };
  return next(specifier, context);
}`, import.meta.url);
