// "The Far Side of the Glass": the narration. The narrator is never named. He is
// revealed in the last shot: the Lieutenant, on the landing under the mountain, who
// can see every future that ends. He tells the world's history as a man who has
// already watched it end every way, and his last line is the game's invitation.

export const VOICE = { name: 'Charon', model: 'gemini-2.5-pro-preview-tts' };

// Two directions. 'soft' made the takes in draft 1 (a tired, gentle narrator). 'cold'
// is the Lieutenant as he should sound: a man who has watched every future end and
// finds the living a little tedious; menace by restraint. `tts.mjs --style cold`
// records it (the takes go to References/cutscene/glass/voice_cold/; music.py plays
// them with VOICE_TAKES=voice_cold).
export const STYLES = {
  soft:
    'Read this as the narrator of a dark fantasy film. You are a tired young man, ' +
    'soft-spoken and low, very close to the microphone, unhurried, leaving real pauses ' +
    'at commas and at the ellipses. Calm and melancholic, as if remembering something ' +
    'you have seen too many times. Never theatrical, never loud. The line:',
  cold:
    'Read this as the narrator of a dark fantasy film. You are a young man who has ' +
    'watched every possible future end, many times, and finds the living faintly ' +
    'tedious. Speak quietly and very precisely, close to the microphone, each word ' +
    'placed like a chess move, with silence left after the important ones. Cold, ' +
    'calculating, faintly amused; menace by restraint. No warmth, no pity, never ' +
    'raise your voice, never theatrical. The line:',
};
export const STYLE = STYLES.soft;
// per-line notes for the cold direction (appended to its style)
export const COLD_NOTES = {
  l09: 'Slow and admiring, as if describing an elegant move.',
  l10: 'Almost a smile: he respects the price.',
  l14: 'Flat, clinical, the way a clerk reads a list.',
  l16: 'Flat certainty, almost bored.',
  l20: 'Barely above a whisper, intimate and unsettling.',
  l21: 'Each place an item on an inventory; no grief at all.',
  l22: 'A trace of contempt for her effort.',
  l23: 'Utterly certain, very quiet.',
  l24:
    'Slowly, straight to the listener, a thin smile you can hear: a dare, with ' +
    'contempt on top and, buried under it, the hope of being surprised.',
};

// id, text (as subtitled), say (as spoken, if different), part
export const LINES = [
  // I. The Morning
  { id: 'l01', part: 'morning', text: 'Before her, nothing came next.' },
  {
    id: 'l02',
    part: 'morning',
    text: 'She asked the dark a question. The dark had no answer… so she became one.',
  },
  {
    id: 'l03',
    part: 'morning',
    text: 'She named the dragons first. Then fire, and wind, and the rivers. And last of all, us.',
  },
  // II. The Spending
  {
    id: 'l04',
    part: 'spending',
    text: 'Then the thing beneath the world turned over in its sleep.',
  },
  { id: 'l05', part: 'spending', text: 'She could not fight it. It was the floor she stood on.' },
  {
    id: 'l06',
    part: 'spending',
    text: 'So she did the only thing a name can do. She spent herself… down to the last syllable.',
  },
  {
    id: 'l07',
    part: 'spending',
    text: 'The next morning, the sun rose hollow. It has risen that way ever since.',
  },
  // III. The Unsworn Night
  {
    id: 'l08',
    part: 'unsworn',
    text: 'For six hundred years, the kings kept one oath. Every name is kept.',
  },
  { id: 'l09', part: 'unsworn', text: 'It took one man, one night… and one list.' },
  {
    id: 'l10',
    part: 'unsworn',
    text: 'He wrote his own name first. That was the price of the door.',
  },
  { id: 'l11', part: 'unsworn', text: 'At midnight, every oath in the kingdom broke at once.' },
  {
    id: 'l12',
    part: 'unsworn',
    text: 'By noon he had no name at all. He called himself the Emperor.',
  },
  // IV. The Roll
  {
    id: 'l13',
    part: 'roll',
    text: 'The last king died in the river where the first one swore. His crown is still down there… somewhere.',
  },
  {
    id: 'l14',
    part: 'roll',
    text: 'Now they write your name in red. And when they need it… they read it into the dark.',
  },
  // V. The officers
  { id: 'l15', part: 'officers', text: 'His officers gave up their names to serve him.' },
  { id: 'l16', part: 'officers', text: 'I know how every one of them dies.' },
  // VI. The one who counts
  {
    id: 'l17',
    part: 'counts',
    text: 'They burned the last hall in the west. A boy got out with a banner… and a coal in a pot.',
  },
  {
    id: 'l18',
    part: 'counts',
    text: 'He still counts the dead. Two hundred and twelve names. He knows them all.',
  },
  {
    id: 'l19',
    part: 'counts',
    text: 'And a girl at the Glass looked into the water… and saw him coming.',
  },
  { id: 'l20', part: 'counts', text: 'I saw her seeing.' },
  // VII. Every way it ends
  {
    id: 'l21',
    part: 'ends',
    text: 'I have watched him die at the Ford. On the bridge. In the fens. At my feet.',
  },
  {
    id: 'l22',
    part: 'ends',
    text: 'And every time, she takes him back to the fire. To the night before.',
  },
  // VIII. The far side
  { id: 'l23', part: 'far', text: 'I have seen every way this ends.' },
  {
    id: 'l24',
    part: 'far',
    text: "Go on, then. Show me one I haven't seen.",
    style:
      'Read this as the narrator of a dark fantasy film. You are a tired young man, ' +
      'soft-spoken, very close to the microphone. Say it slowly, with a pause after ' +
      '"then", directly to the listener, with a faint, weary smile you can hear; a ' +
      'challenge and, underneath it, a hope. The line:',
  },
];

// The Japanese narration (`tts.mjs --lang ja`; music.py --version ja), English captions
// kept. He speaks as he would in a Japanese dub: 私, plain forms, the officers as 彼ら,
// the listener as お前 once (l14). A few words are written in kana so the voice cannot
// misread them (うつろ, いちおん). l21 keeps five phrases so each place lands on its cut.
export const JA = {
  l01: '彼女より前には、何ひとつ、次に続くものはなかった。',
  l02: '彼女は闇に問いかけた。闇は答えを持たなかった……だから、彼女自身が答えになった。',
  l03: '彼女は、まず竜に名を与えた。次に火を。風を。川を。そして最後に……我々に。',
  l04: 'やがて、世界の下で眠るものが、寝返りを打った。',
  l05: '彼女には抗えなかった。それは、彼女が立つ大地そのものだったのだから。',
  l06: 'だから彼女は、名にできるただひとつのことをした。己を使い果たしたのだ……最後のいちおんまで。',
  l07: '翌朝、太陽はうつろに昇った。以来ずっと、そうして昇り続けている。',
  l08: '六百年のあいだ、王たちはひとつの誓いを守り続けた。すべての名は、守られる、と。',
  l09: 'それを終わらせたのは、一人の男と、一夜と……一枚の名簿だった。',
  l10: '男は、まず自らの名を書いた。それが、扉の代価だった。',
  l11: '真夜中。王国のあらゆる誓いが、一斉に砕け散った。',
  l12: '正午には、男にはもう名などなかった。彼は自らを、皇帝と名乗った。',
  l13: '最後の王は、最初の王が誓いを立てた川で死んだ。その冠は、今もあの水の底にある……どこかに。',
  l14: '今や彼らは、お前の名を赤で記す。そして、必要とあらば……闇へと読み上げる。',
  l15: '皇帝の将たちは、仕えるために、己の名を差し出した。',
  l16: '彼らが一人残らずどう死ぬか……私は知っている。',
  l17: '彼らは、西の最後の館を焼いた。一人の少年が、逃げ延びた。旗と……壺に入れた、ひとかけらの火を抱えて。',
  l18: '彼は今も、死者を数えている。二百十二の名。そのすべてを、覚えている。',
  l19: 'そして、鏡の湖を覗き込んだ娘が……彼の来るのを、見た。',
  l20: '見る彼女を、私は見ていた。',
  l21: '私は、彼が死ぬのを見てきた。浅瀬で。橋の上で。沼地で。私の足元で。',
  l22: 'そしてそのたびに、彼女は彼を焚き火のもとへ連れ戻す。あの、前夜へと。',
  l23: 'これがどう終わるか……そのすべてを、私は見てきた。',
  l24: 'さあ。私がまだ見ていない結末を……見せてみろ。',
};

STYLES.cold_ja =
  'Speak the following Japanese line, in natural Japanese, as the narrator of a dark ' +
  'fantasy anime film (a seiyuu performance, not a reading). You are a young man who ' +
  'has watched every possible future end, many times, and finds the living faintly ' +
  'tedious. Quiet, precise, close to the microphone, each word placed like a chess ' +
  'move, silence after the important ones. Cold, calculating, faintly amused; menace ' +
  'by restraint. No warmth, never raise your voice, never theatrical. The line:';
