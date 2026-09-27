#!/usr/bin/env python3
"""Ask Gemini about a few media files (audio or images): voice auditions, stills, a mix.

  python3 tools/cutscene/glass/judge.py "question" file1.wav file2.wav ...

Files are sent inline and labelled by name, so the answer can refer to them.
The egress proxy adds the API key (see tools/art/gen/geminiImage.mjs).
"""

import base64
import json
import mimetypes
import os
import subprocess
import sys
import tempfile

MODEL = os.environ.get('JUDGE_MODEL', 'gemini-3.1-pro-preview')


def main():
    q, files = sys.argv[1], sys.argv[2:]
    parts = [{'text': q}]
    for f in files:
        mime = mimetypes.guess_type(f)[0] or 'application/octet-stream'
        if f.endswith('.mp3'):
            mime = 'audio/mp3'
        parts.append({'text': f'File: {os.path.basename(f)}'})
        if f.endswith('.wav'):
            # keep the request small: speech survives 64 kbps MP3 fine
            data = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', f, '-b:a', '64k', '-f',
                                   'mp3', '-'], capture_output=True, check=True).stdout
            mime = 'audio/mp3'
        else:
            with open(f, 'rb') as fh:
                data = fh.read()
        parts.append({'inlineData': {'mimeType': mime, 'data': base64.b64encode(data).decode()}})
    body = {'contents': [{'parts': parts}]}
    with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as tmp:
        json.dump(body, tmp)
    url = f'https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent'
    args = ['curl', '-sS', '-X', 'POST', '-H', 'Content-Type: application/json', url,
            '--max-time', '600', '--data-binary', f'@{tmp.name}']
    key = os.environ.get('GEMINI_API_KEY') or os.environ.get('GOOGLE_API_KEY')
    if key:
        args[5:5] = ['-H', f'x-goog-api-key: {key}']
    out = subprocess.run(args, capture_output=True, text=True).stdout
    os.unlink(tmp.name)
    try:
        j = json.loads(out)
    except json.JSONDecodeError:
        sys.exit(f'bad response: {out[:500]}')
    try:
        print(''.join(p.get('text', '') for p in j['candidates'][0]['content']['parts']))
    except (KeyError, IndexError):
        print(json.dumps(j)[:800])


if __name__ == '__main__':
    main()
