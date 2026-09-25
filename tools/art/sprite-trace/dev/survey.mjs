// Survey every roster source: recovered native size, grid pitch/confidence, reduction
// scale and slots found. Flags likely outliers (strong reduction, no face, no eyes).
//   node tools/art/sprite-trace/dev/survey.mjs [--ids a,b] [--json out.json]
import { writeFileSync } from 'node:fs';
import { ROSTER } from '../roster.mjs';
import { loadNative, traceId } from '../lib/pipeline.mjs';
import { SLOT } from '../lib/slots.mjs';

const args = process.argv.slice(2);
const flag = (n) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : null;
};
const ids = flag('ids')?.split(',') || Object.keys(ROSTER.sources);
const rows = [];
for (const id of ids) {
  const t0 = Date.now();
  try {
    const n = await loadNative(id);
    const t = await traceId(id);
    const sp = t.sprite;
    let eyes = 0,
      skin = 0,
      colours = new Set();
    for (let i = 0; i < sp.w * sp.h; i++) {
      if (sp.slot[i] === SLOT.eye) eyes++;
      if (sp.slot[i] === SLOT.skin) skin++;
      if (sp.slot[i]) colours.add(`${sp.slot[i]}:${sp.shade[i]}`);
    }
    const row = {
      id,
      native: `${n.native.w}x${n.native.h}`,
      pitch: n.pitch ? `${(+n.pitch.x).toFixed(2)}/${(+n.pitch.y).toFixed(2)}` : '-',
      conf: +(n.confidence ?? 0).toFixed(2),
      scale: +sp.meta.scale.toFixed(2),
      face: !!t.seg.face,
      eyes,
      skin,
      colours: colours.size,
      ms: Date.now() - t0,
    };
    rows.push(row);
    console.log(Object.values(row).join('\t'));
  } catch (e) {
    console.log(`${id}\tERROR ${e.message}`);
    rows.push({ id, error: e.message });
  }
}
if (flag('json')) writeFileSync(flag('json'), JSON.stringify(rows, null, 2));
