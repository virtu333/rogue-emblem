"""Write boards/<scene>_edit.json: the cuts of each scene, each a slice of a take (or a code
shot), placed on the score, with the engine's timing and effects. Edit the tables here, not the
JSON. `src` defaults to the take time that lines up with the cut's start (cut.from - take
range start); `dsrc` nudges it when the generated action runs early or late.

    python3 tools/cutscene/unwritten/boards/make_edits.py
"""
import json, os
HERE = os.path.dirname(os.path.abspath(__file__))

def build(scene, cuts):
    B = json.load(open(os.path.join(HERE, f'{scene}.json')))
    takes = {t['id']: t for t in B['takes']}
    out = []
    for c in cuts:
        c = dict(c)
        if 'take' in c:
            t = takes[c['take']]
            c.setdefault('clip', f"{scene}_{c['name']}")
            c['src'] = round(c.get('src', c['from'] - t['range'][0]) + c.pop('dsrc', 0), 3)
        out.append(c)
    json.dump({'scene': scene, 'cuts': out}, open(os.path.join(HERE, f'{scene}_edit.json'), 'w'), indent=1)
    print(scene, len(out), 'cuts')

# --- The Ford (shot edges from ford.js S; times are piece seconds) -------------------------
CLASH, CUT, FALL, LAND = 7.2, 11.2, 12.0, 12.4
build('ford', [
    {'name': 'rush', 'from': 0.0, 'to': 0.8, 'code': 'rush'},
    {'name': 'wide', 'from': 0.8, 'to': 2.4, 'take': 'W', 'cam': {'zoom': [1.0, 1.04]},
     'flash': [{'t': 0.8, 'frames': 2}]},
    {'name': 'low', 'from': 2.4, 'to': 3.2, 'take': 'L', 'cam': {'zoom': [1.04, 1.0]},
     'shake': [[2.4, 0.5]]},
    {'name': 'level', 'from': 3.2, 'to': 4.0, 'take': 'V', 'src': 2.75, 'cam': {'zoom': [1.0, 1.08]},
     'shake': [[3.55, 0.7]]},  # the generated snap lands at take 3.1 s
    {'name': 'track', 'from': 4.0, 'to': 5.2, 'take': 'T'},
    {'name': 'eye', 'from': 5.2, 'to': 5.6, 'code': 'eye'},
    {'name': 'ots', 'from': 5.6, 'to': 6.2, 'take': 'O', 'shake': [[6.0, 0.6]]},
    {'name': 'spray', 'from': 6.2, 'to': 6.8, 'take': 'S', 'dsrc': 0.5},
    {'name': 'wall', 'from': 6.8, 'to': 7.0, 'take': 'S', 'dsrc': 1.3, 'cam': {'zoom': [1.15, 1.2]}},
    {'name': 'slit', 'from': 7.0, 'to': 7.1, 'take': 'H', 'src': 0.3},
    {'name': 'shape', 'from': 7.1, 'to': 7.2, 'take': 'S', 'dsrc': 1.8, 'cam': {'zoom': [1.2, 1.2]}},
    {'name': 'clash', 'from': CLASH, 'to': 8.0, 'take': 'M',
     'stops': [{'t': CLASH + 0.04, 'hold': 3, 'catch': 4}], 'shake': [[CLASH, 1.2]],
     'flash': [{'t': CLASH, 'frames': 1}], 'impact': [{'t': CLASH + 1 / 24, 'frames': 2}],
     'cam': {'zoom': [1.08, 1.0]}},
    {'name': 'bind', 'from': 8.0, 'to': 9.6, 'take': 'M', 'cam': {'zoom': [1.0, 1.1], 'ease': 'linear'}},
    {'name': 'helm', 'from': 9.6, 'to': 10.4, 'take': 'H', 'src': 0.6, 'cam': {'zoom': [1.0, 1.06]}},
    {'name': 'yield', 'from': 10.4, 'to': CUT, 'take': 'M', 'cam': {'zoom': [1.06, 1.0]}},
    {'name': 'cut', 'from': CUT, 'to': 11.6, 'take': 'M',
     'stops': [{'t': CUT + 0.02, 'hold': 4, 'catch': 4}], 'shake': [[CUT, 1.5]],
     'impact': [{'t': CUT, 'frames': 2, 'crimson': True}], 'cam': {'zoom': [1.1, 1.04]}},
    {'name': 'face', 'from': 11.6, 'to': FALL, 'take': 'F', 'src': 0.95, 'rate': 0.6,
     'shake': [[11.6, 1.0]]},
    {'name': 'fall', 'from': FALL, 'to': 13.6, 'take': 'R', 'shake': [[FALL, 0.6], [LAND, 0.8]],
     'cam': {'zoom': [1.0, 1.05]}},
])

# --- The Night Before (camp_blocking S) ------------------------------------------------------
build('camp', [
    {'name': 'crane', 'from': 0.0, 'to': 3.2, 'take': 'CW', 'flash': [{'t': 0.0, 'frames': 2}]},
    {'name': 'three', 'from': 3.2, 'to': 4.8, 'take': 'C3', 'cam': {'zoom': [1.0, 1.05], 'ease': 'linear'}},
    {'name': 'sera', 'from': 4.8, 'to': 6.4, 'take': 'CS', 'dsrc': 1.7, 'cam': {'zoom': [1.0, 1.06], 'ease': 'linear'}},
    {'name': 'sky', 'from': 6.4, 'to': 8.0, 'code': 'sky'},
    {'name': 'edric', 'from': 8.0, 'to': 9.6, 'take': 'CE', 'dsrc': 1.6, 'cam': {'zoom': [1.0, 1.06], 'ease': 'linear'}},
    {'name': 'kira', 'from': 9.6, 'to': 10.8, 'take': 'CK', 'dsrc': 1.1, 'cam': {'zoom': [1.0, 1.05], 'ease': 'linear'}},
    # the take invents a fourth person at 3.5 s: play the rise a little fast and hold him
    # standing from the big hit (12.3) on
    {'name': 'rise', 'from': 10.8, 'to': 12.8, 'take': 'CR', 'src': 1.6, 'rate': 1.03,
     'hold': [12.3, 13.0], 'shake': [[12.3, 0.6]], 'cam': {'zoom': [1.04, 1.0]}},
])
