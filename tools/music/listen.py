#!/usr/bin/env python3
"""Ask a Gemini audio model to listen to audio files and answer a prompt.

The composer's second pair of ears: renders are uploaded through the Gemini
Files API and reviewed by an audio-capable model. Retries across models on
upstream errors. Needs network access to generativelanguage.googleapis.com
(an API key via GOOGLE_API_KEY, or a proxy that injects one).

  python3 tools/music/listen.py a.mp3 b.mp3 --prompt "Compare these."
"""
import argparse
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request

API = 'https://generativelanguage.googleapis.com'
MODELS = ['gemini-pro-latest', 'gemini-3.1-pro-preview', 'gemini-3.5-flash']


def _req(url, data=None, headers=None, method=None, timeout=900):
    headers = dict(headers or {})
    key = os.environ.get('GOOGLE_API_KEY')
    if key:
        headers['x-goog-api-key'] = key
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    return urllib.request.urlopen(req, timeout=timeout)


def upload(path):
    mt = 'audio/mpeg' if path.endswith('.mp3') else 'audio/wav'
    data = open(path, 'rb').read()
    r = _req(f'{API}/upload/v1beta/files', data=json.dumps(
        {'file': {'display_name': os.path.basename(path)}}).encode(), headers={
        'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': str(len(data)),
        'X-Goog-Upload-Header-Content-Type': mt, 'Content-Type': 'application/json'},
        method='POST')
    url = r.headers['X-Goog-Upload-URL']
    r = _req(url, data=data, headers={'X-Goog-Upload-Offset': '0',
                                      'X-Goog-Upload-Command': 'upload, finalize'},
             method='POST')
    info = json.loads(r.read())['file']
    # wait until processed
    for _ in range(60):
        if info.get('state') in (None, 'ACTIVE'):
            break
        time.sleep(2)
        info = json.loads(_req(f"{API}/v1beta/{info['name']}").read())
    return info['uri'], mt


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('files', nargs='+')
    ap.add_argument('--prompt', required=True)
    ap.add_argument('--model')
    ap.add_argument('--inline', action='store_true')
    a = ap.parse_args()
    parts = []
    for f in a.files:
        parts.append({'text': f'File: {os.path.basename(f)}'})
        if a.inline:
            mt = 'audio/mpeg' if f.endswith('.mp3') else 'audio/wav'
            parts.append({'inlineData': {'mimeType': mt,
                                         'data': base64.b64encode(open(f, 'rb').read()).decode()}})
        else:
            for attempt in range(5):
                try:
                    uri, mt = upload(f)
                    break
                except Exception as e:  # noqa: BLE001
                    print('upload retry', e, file=sys.stderr)
                    time.sleep(5 * (attempt + 1))
            else:
                sys.exit('upload failed')
            parts.append({'fileData': {'mimeType': mt, 'fileUri': uri}})
    parts.append({'text': a.prompt})
    body = json.dumps({'contents': [{'role': 'user', 'parts': parts}],
                       'generationConfig': {'temperature': 0.4}}).encode()
    models = [a.model] if a.model else MODELS
    for attempt in range(9):
        model = models[min(attempt // 3, len(models) - 1)]
        try:
            d = json.loads(_req(f'{API}/v1beta/models/{model}:generateContent', data=body,
                                headers={'Content-Type': 'application/json'}).read())
            break
        except urllib.error.HTTPError as e:
            print('HTTP', e.code, model, e.read().decode()[:200], file=sys.stderr)
            time.sleep(8 * (attempt % 3 + 1))
        except Exception as e:  # noqa: BLE001
            print('ERR', model, e, file=sys.stderr)
            time.sleep(8)
    else:
        sys.exit(1)
    print(f'[{model}]')
    for c in d.get('candidates', []):
        for p in c['content']['parts']:
            if 'text' in p:
                print(p['text'])


if __name__ == '__main__':
    main()
