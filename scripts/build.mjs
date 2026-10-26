import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const path = name => new URL(name, root);
mkdirSync(path('dist/'), { recursive: true });
const licenses = ['LICENSE', 'licenses/webgpu-black-hole-MIT.txt', 'licenses/three-MIT.txt']
  .map(name => readFileSync(path(name), 'utf8')).join('\n\n');
const common = { bundle: true, write: false, minify: true, target: 'es2022',
  loader: { '.jpg': 'dataurl' }, legalComments: 'inline', banner: { js: '/*! Gargantua 0.2.0 — MIT; see LICENSE and THIRD_PARTY_NOTICES.md. */' } };
// 模块供嵌入；单文件演示供离线直接打开。二者都内嵌真实静帧与运行依赖。
const moduleResult = await build({ ...common, entryPoints: [fileURLToPath(path('src/core.js'))], format: 'esm' });
writeFileSync(path('dist/gargantua.js'), moduleResult.outputFiles[0].text + '\n/*\n' + licenses + '\n*/\n');
const demo = await build({ ...common, entryPoints: [fileURLToPath(path('src/demo.js'))], format: 'iife' });
const html = readFileSync(path('src/demo.html'), 'utf8').replace('__LICENSES__', licenses.replaceAll('--','—'))
  .replace('__BUNDLE__', () => demo.outputFiles[0].text.replaceAll('</script', '<\\/script'));
writeFileSync(path('gargantua.html'), html);
console.log('Gargantua: gargantua.html + dist/gargantua.js');
