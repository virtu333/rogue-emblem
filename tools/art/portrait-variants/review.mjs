#!/usr/bin/env node
// Review bookkeeping for portrait variant generations.
//
//   node tools/art/portrait-variants/review.mjs accept id [id...]     keep these raws
//   node tools/art/portrait-variants/review.mjs retake id "note"      redraw (bumps the take)
//   node tools/art/portrait-variants/review.mjs status
//
// review.json records the raw hash of every generation that was looked at on
// its faction plate at display size and accepted. An accepted raw is kept even
// when a reference it copied (a costume default) is redrawn later. A retake
// drops the acceptance and bumps notes.json's take (plus an optional fix
// note), which changes the prompt, so generate.mjs draws it again.
import { createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const RAW = join(ROOT, 'References/portrait-variants/raw');
const REVIEW = join(ROOT, 'tools/art/portrait-variants/review.json');
const NOTES = join(ROOT, 'tools/art/portrait-variants/notes.json');
const read = (f, d) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : d);
const write = (f, v) => {
  const sorted = Object.fromEntries(
    Object.keys(v)
      .sort()
      .map((k) => [k, v[k]]),
  );
  writeFileSync(f, `${JSON.stringify(sorted, null, 2)}\n`);
};
const sha = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 16);
const rawFile = (id) =>
  ['.png', '.jpg'].map((e) => join(RAW, id + e)).find((f) => existsSync(f)) || null;

const [cmd, ...rest] = process.argv.slice(2);
const review = read(REVIEW, { accepted: {} });
const notes = read(NOTES, {});

if (cmd === 'accept') {
  for (const id of rest) {
    const f = rawFile(id);
    if (!f) {
      console.log(`no raw for ${id}`);
      continue;
    }
    review.accepted[id] = sha(readFileSync(f));
  }
  review.accepted = Object.fromEntries(
    Object.keys(review.accepted)
      .sort()
      .map((k) => [k, review.accepted[k]]),
  );
  write(REVIEW, review);
  console.log(`accepted ${rest.length}; ${Object.keys(review.accepted).length} in total`);
} else if (cmd === 'retake') {
  const [id, note] = rest;
  delete review.accepted[id];
  const entry = notes[id] || {};
  entry.take = (entry.take || 1) + 1;
  if (note) entry.note = note;
  notes[id] = entry;
  write(REVIEW, review);
  write(NOTES, notes);
  console.log(`${id}: take ${entry.take}${note ? ` (${note})` : ''}`);
} else {
  console.log(
    `accepted: ${Object.keys(review.accepted).length}; retakes noted: ${Object.keys(notes).length}`,
  );
}
