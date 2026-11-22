import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, 'dist');
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const item of ['index.html', 'slides', 'Presentacion_trabajo_final_etica.pptx', 'Presentacion_trabajo_final_etica.pdf']) {
  await cp(join(root, item), join(dist, item), { recursive: true });
}
