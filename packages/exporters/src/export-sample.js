import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { samplePage } from '@builder/document';
import { exportHtml, exportReact, exportVue } from './index.js';

for (const [target, files] of Object.entries({ html: exportHtml(samplePage), react: exportReact(samplePage), vue: exportVue(samplePage) })) {
  for (const [name, contents] of Object.entries(files)) {
    const path = join('generated', target, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents);
  }
  console.log(`Generated ${target} project in generated/${target}`);
}
