#!/usr/bin/env node
// The narrator's lines (Gemini TTS). Each line is rendered to its own WAV so the score
// and the picture can be laid out around its measured length. Cached by request hash.
//
//   node tools/cutscene/glass/tts.mjs                 all lines in script.mjs
//   node tools/cutscene/glass/tts.mjs --only l03 --force
//   node tools/cutscene/glass/tts.mjs --audition      one line in several voices
//   add --style cold for the Lieutenant's cold direction (see script.mjs)

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { LINES, VOICE, STYLES, COLD_NOTES } from './script.mjs';
import { curlJson } from '../../art/gen/geminiImage.mjs';

const API = 'https://generativelanguage.googleapis.com/v1beta';

const argv = process.argv.slice(2);
const has = (k) => argv.includes(`--${k}`);
const arg = (k, d) => (has(k) ? argv[argv.indexOf(`--${k}`) + 1] : d);

function wav(pcm, rate = 24000) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

export async function speak({ text, voice, style, model, out, force }) {
  const prompt = `${style}\n\n${text}`;
  const hash = createHash('sha256').update(JSON.stringify({ prompt, voice, model })).digest('hex');
  const meta = `${out}.json`;
  if (!force && fs.existsSync(meta) && JSON.parse(fs.readFileSync(meta)).hash === hash)
    return { file: `${out}.wav`, cached: true };
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
    },
  };
  for (let attempt = 0; ; attempt++) {
    const j = await curlJson(`${API}/models/${model}:generateContent`, body);
    const part = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
    if (part) {
      const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType)?.[1] || 24000);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(`${out}.wav`, wav(Buffer.from(part.inlineData.data, 'base64'), rate));
      fs.writeFileSync(meta, JSON.stringify({ hash, text, voice, model, style }, null, 1));
      return { file: `${out}.wav`, cached: false };
    }
    if (attempt >= 3) throw new Error(JSON.stringify(j).slice(0, 400));
    await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
  }
}

const model = arg('model', VOICE.model);
// --style soft (draft 1, into voice/) | cold (into voice_cold/)
const styleName = arg('style', 'soft');
const STYLE = STYLES[styleName];
const OUT = `References/cutscene/glass/${styleName === 'soft' ? 'voice' : `voice_${styleName}`}`;
const lineStyle = (l) =>
  styleName === 'cold'
    ? `${STYLE.replace(/ The line:$/, '')} ${COLD_NOTES[l.id] || ''} The line:`
    : l.style || STYLE;
if (has('audition')) {
  const voices = arg('voices', 'Enceladus,Algieba,Charon,Iapetus,Algenib,Umbriel').split(',');
  const text = arg('text', LINES[0].text);
  await Promise.all(
    voices.map(async (v) => {
      const r = await speak({
        text,
        voice: v,
        style: STYLE,
        model,
        out: path.join(OUT, 'audition', `${v}_${model}`),
        force: has('force'),
      });
      console.log(r.file);
    }),
  );
} else {
  const only = arg('only') ? new Set(arg('only').split(',')) : null;
  const todo = LINES.filter((l) => !only || only.has(l.id));
  const conc = 4;
  const queue = [...todo];
  await Promise.all(
    Array.from({ length: conc }, async () => {
      while (queue.length) {
        const l = queue.shift();
        try {
          const r = await speak({
            text: l.say || l.text,
            voice: l.voice || VOICE.name,
            style: lineStyle(l),
            model,
            out: path.join(OUT, l.id),
            force: has('force'),
          });
          console.log(`${l.id}: ${r.file}${r.cached ? ' (cached)' : ''}`);
        } catch (e) {
          console.error(`${l.id}: ${e.message}`);
        }
      }
    }),
  );
}
