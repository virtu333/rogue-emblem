// Dev lineup: node dev/lineup.mjs out.png cls:faction[:pose[:frame]] ...
import { renderUnit } from '../lib/build.mjs';
import { Img } from '../lib/image.mjs';
import { strip } from './zoom.mjs';

const [out, ...specs] = process.argv.slice(2);
const items = [];
for (const s of specs) {
  if (s.startsWith('ref=')) {
    items.push({ img: await Img.read(s.slice(4)), label: 'rebuilt' });
    continue;
  }
  const [cls, faction = 'player', pose = 'idle', frame = '0'] = s.split(':');
  const { rgba } = renderUnit({ cls, faction, pose, frame: +frame, seed: 3 });
  items.push({
    img: Img.from(64, 64, rgba),
    label: `${cls.slice(0, 10)} ${faction[0]}${pose === 'idle' ? '' : ' ' + pose}`,
  });
}
await strip(items, out, {
  zoom: +(process.env.ZOOM || 6),
  crop: (process.env.CROP || '10,2,44,44').split(',').map(Number),
});
