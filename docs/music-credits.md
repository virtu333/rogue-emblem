# Music credits and licences

The score of Rogue Dawn is original: it is written as Python scores in `tools/music/`
and rendered to audio with the free sample libraries below. The samples themselves
never ship. The game ships the rendered music (`assets/audio/music/`,
`assets/audio/stingers/`).

The in-game credit is the **Music Credits** page of the help overlay (the Meta tab,
`src/data/helpContent.js`). Keep it in step with this file and with the house palette
(`HOUSE` in `tools/music/engine/palette.py`).

## The soundtrack's licence

Some of the samples are CC BY-SA. Under ShareAlike, music built on them may count as an
adaptation. So the rendered soundtrack is released under
**[Creative Commons Attribution-ShareAlike 4.0](https://creativecommons.org/licenses/by-sa/4.0/)**.
Credit it as "Rogue Dawn original soundtrack". This covers the music only. The game's
code and art are not affected.

The Sonatina Symphonic Orchestra licence (CC Sampling Plus 1.0) does not allow using
the work "to advertise for or promote anything but the work you create from it". It is
unclear whether a trailer or store video for the game counts. Settle that before using
the music in marketing.

## Libraries

| Library | Author | Licence | Plays |
|---|---|---|---|
| [Sonatina Symphonic Orchestra](https://github.com/peastman/sso) (SSO 4) | Mattias Westlund and contributors | [CC Sampling Plus 1.0](https://creativecommons.org/licenses/sampling+/1.0/) | solo violin, oboe, celesta, the choir's "oohs" |
| [Virtual Playing Orchestra 3](http://virtualplaying.com/virtual-playing-orchestra/) | Paul Battersby | GPL-3.0 (its SFZ programs); samples as below | string sections, horns, trumpets, trombones |
| - Sonatina Symphonic Orchestra 1.0 samples | Mattias Westlund | CC Sampling Plus 1.0 | 1st and 2nd violins, basses |
| - Mattias Westlund additional samples | Mattias Westlund | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | violas, horns |
| - No Budget Orchestra 1 and 2 | Jeff Glatt | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | celli, trumpets, trombones |
| [VSCO 2 Community Edition](https://github.com/sgossner/VSCO-2-CE) | Versilian Studios | CC0 | woodwinds (except the oboe), tuba, muted brass, harp, organ, pitched and orchestral percussion, timpani |
| [Versilian Community Sample Library](https://github.com/sgossner/VCSL) | Versilian Studios | CC0 | the colosseum's frame drum |
| [GeneralUser GS](https://github.com/mrbumpy409/GeneralUser-GS) | S. Christian Collins | free for commercial music | choir, taiko, accordion, nylon guitar |
| [Virtuosity Drums](https://github.com/sfzinstruments/virtuosity_drums) | Versilian Studios | CC0 | drum kit |
| [Karoryfer Growlybass](https://github.com/sfzinstruments/karoryfer.growlybass) | Karoryfer Samples | CC0 | bass guitar |
| [Splendid Grand Piano](https://github.com/sfzinstruments/SplendidGrandPiano) | AKAI (via sfzinstruments) | public domain | piano |

VPO3's own solo violin is not used: its source recording's licence is unclear and may be
non-commercial. `tools/music/engine/palette.py` lists every candidate the sound lab tried.
The notes above describe only what the house palette plays.
