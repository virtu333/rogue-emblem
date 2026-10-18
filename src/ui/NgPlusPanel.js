// NgPlusPanel.js - the Home Base NG+ tab (docs/specs/ng-plus.md): buy NG+, pick who rides
// again after a Black Sun win, and choose which veterans to bring. Presentation
// only: the words come from ui/ngPlusModel.js and every change is a meta command, saved there.
import {
  barracksView,
  candidateDetail,
  draftPicks,
  echoLine,
  echoPreview,
  ngPlusBlockText,
  rideView,
  unlockView,
  upgradesView,
} from './ngPlusModel.js';

const node = (tag, cls, text) => {
  const el = document.createElement(tag);
  el.className = cls;
  if (text != null) el.textContent = text;
  return el;
};

export class NgPlusPanel {
  /** @param {import('./MobileHomeBase.js').MobileHomeBase} home */
  constructor(home) {
    this.home = home;
    this.meta = home.meta;
    this.draft = {}; // ref -> { skillId, itemUid, replaceSkillId, replaceItemUid }
    this.focus = null; // { kind: 'candidate' | 'record', id }
    this.confirmRelease = null;
    this.confirmPass = false;
  }

  get gameData() {
    return this.home.scene.gameData || {};
  }

  rerender(focus = null, message = null) {
    if (message != null) this.home.message = message;
    this.home.render(focus);
  }

  button(label, action, { pressed = null, focus = null, cls = null, disabled = false } = {}) {
    const b = this.home.button(label, action, pressed);
    if (cls) b.className = cls;
    if (focus) b.dataset.focus = focus;
    b.disabled = disabled;
    return b;
  }

  /** Fill the tab's list and detail; returns the ride's commit button for the action bar, or null. */
  render(list, copy) {
    const unlock = unlockView(this.meta);
    if (!unlock.unlocked) {
      this.renderUnlock(copy, unlock);
      return null;
    }
    const state = this.meta.getNgPlus();
    const ride = rideView(state, this.draft);
    if (!ride) this.draft = {};
    if (ride) {
      list.append(node('h3', 'ng-heading', ride.title));
      for (const c of ride.candidates) {
        const b = this.button(
          '',
          () => {
            // Opening a survivor never drops another's choices: tap freely between them, and
            // remove one from the pick with its own button.
            if (!this.draft[c.ref] && !c.full) this.draft[c.ref] = {};
            this.focus = { kind: 'candidate', id: c.ref };
            this.rerender(`ride-${c.ref}`);
          },
          { pressed: c.picked, focus: `ride-${c.ref}`, cls: 'mh-skill', disabled: c.disabled },
        );
        b.append(
          node(
            'strong',
            '',
            `${c.name}${c.sent ? ' · Sent to the Barracks' : c.picked ? ' · Rides again' : ''}`,
          ),
          node('span', '', c.line),
          ...(c.echoText ? [node('span', 'ng-echo', c.echoText)] : []),
        );
        list.append(b);
      }
    }
    const barracks = barracksView(state, this.gameData, this.meta.ngPlusBringLimit());
    list.append(node('h3', 'ng-heading', `${barracks.title} · ${barracks.bringCount}`));
    if (barracks.records.length)
      list.append(
        node(
          'p',
          'mu-help ng-echo',
          `Next NG+ run · ${echoLine(echoPreview(this.meta), this.gameData)}`,
        ),
      );
    for (const r of barracks.records) {
      const b = this.button(
        '',
        () => {
          this.focus = { kind: 'record', id: r.id };
          this.confirmRelease = null;
          this.rerender(`vet-${r.id}`);
        },
        { pressed: this.focus?.id === r.id, focus: `vet-${r.id}`, cls: 'mh-skill' },
      );
      b.append(
        node('strong', '', `${r.name}${r.brought ? ' · Bringing' : ''}`),
        node('span', '', r.line),
      );
      list.append(b);
    }
    if (!barracks.records.length) list.append(node('p', 'mu-help', barracks.lead));
    const upgrades = upgradesView(this.meta);
    list.append(node('h3', 'ng-heading', 'Upgrades'));
    for (const u of upgrades) {
      const b = this.button(
        '',
        () => {
          this.focus = { kind: 'upgrade', id: u.id };
          this.rerender(`ng-upgrade-${u.id}`);
        },
        { pressed: this.focus?.id === u.id, focus: `ng-upgrade-${u.id}`, cls: 'mh-skill' },
      );
      b.append(node('strong', '', u.name), node('span', '', `${u.tierLine} · ${u.now}`));
      list.append(b);
    }

    const focusedCandidate =
      this.focus?.kind === 'candidate' && ride?.candidates.find((c) => c.ref === this.focus.id);
    if (focusedCandidate && !focusedCandidate.sent)
      this.renderCandidate(copy, state, focusedCandidate);
    else if (this.focus?.kind === 'record') this.renderRecord(copy, barracks, this.focus.id);
    else if (this.focus?.kind === 'upgrade')
      this.renderUpgrade(
        copy,
        upgrades.find((u) => u.id === this.focus.id),
      );
    else {
      copy.append(node('h2', '', 'New Game+'));
      copy.append(node('p', 'mu-help', barracks.lead));
    }
    // The ride's commit sits beside Begin Run, always in reach (MobileHomeBase's actions).
    return ride ? this.renderRideActions(copy, ride) : null;
  }

  renderUnlock(copy, unlock) {
    copy.append(node('h2', '', unlock.title));
    for (const line of unlock.lines) copy.append(node('p', 'mu-help', line));
    copy.append(node('p', '', unlock.cost));
    if (unlock.blockText) copy.append(node('p', 'mu-requirements', unlock.blockText));
    // Not the action bar's: Begin Run stays the one primary there.
    copy.append(
      this.button(
        unlock.buyLabel,
        () => {
          const result = this.meta.unlockNgPlus();
          this.rerender(
            'ng-unlock',
            result.ok ? 'New Game+ unlocked.' : ngPlusBlockText(result.reason),
          );
        },
        { focus: 'ng-unlock', cls: 'mu-buy', disabled: !unlock.canBuy },
      ),
    );
  }

  renderUpgrade(copy, u) {
    if (!u) return;
    // The price and the Buy button come first, so a short landscape phone shows them unscrolled.
    copy.append(node('h2', '', u.name), node('p', '', `${u.tierLine} · ${u.now}`));
    if (u.cost) copy.append(node('p', 'mu-help', u.cost));
    if (u.blockText) copy.append(node('p', 'mu-requirements', u.blockText));
    copy.append(
      this.button(
        u.buyLabel,
        () => {
          const result = this.meta.buyNgPlusUpgrade(u.id);
          this.rerender(
            `ng-buy-${u.id}`,
            result.ok ? `${u.name}: tier ${result.tier}.` : ngPlusBlockText(result.reason),
          );
        },
        { focus: `ng-buy-${u.id}`, cls: 'mu-buy', disabled: !u.canBuy },
      ),
    );
    copy.append(node('p', 'mu-help', u.lead));
  }

  renderCandidate(copy, state, candidate) {
    const { ref } = candidate;
    const pick = this.draft[ref];
    const view = candidateDetail(state, ref, pick, this.gameData);
    if (!view) return;
    copy.append(node('h2', '', view.name), node('p', 'mu-help', `${view.line} · ${view.record}`));
    if (!pick) {
      // A full slot: their loadout to read, nothing to choose until someone is removed.
      copy.append(node('p', 'mu-requirements', candidate.fullText));
      const skills = view.skills.map((s) => s.label).join(', ');
      const items = view.items.map((i) => i.label).join(', ');
      copy.append(node('p', '', `Skills: ${skills || 'none to keep'}`));
      copy.append(node('p', '', `Items: ${items || 'none to keep'}`));
      return;
    }
    const set = (patch, focus) => {
      Object.assign(pick, patch);
      this.rerender(focus);
    };
    copy.append(node('h3', 'ng-heading', 'Keep one skill'));
    if (!view.skills.length) copy.append(node('p', 'mu-help', 'No skill of theirs to keep.'));
    for (const s of view.skills)
      copy.append(
        this.button(
          `${s.label} · ${s.kind}`,
          () =>
            set({ skillId: s.chosen ? null : s.id, replaceSkillId: null }, `keep-skill-${s.id}`),
          { pressed: s.chosen, focus: `keep-skill-${s.id}` },
        ),
      );
    if (view.skillReplace) {
      copy.append(node('p', 'mu-requirements', 'Kept skills are full. Replace:'));
      for (const s of view.skillReplace)
        copy.append(
          this.button(s.label, () => set({ replaceSkillId: s.id }, `swap-skill-${s.id}`), {
            pressed: s.chosen,
            focus: `swap-skill-${s.id}`,
          }),
        );
    }
    copy.append(node('h3', 'ng-heading', 'Keep one item'));
    if (!view.items.length) copy.append(node('p', 'mu-help', 'No item of theirs to keep.'));
    if (view.heirlooms.length)
      copy.append(node('p', 'mu-help', `Not theirs to keep: ${view.heirlooms.join(', ')}.`));
    for (const i of view.items)
      copy.append(
        this.button(
          i.label,
          () =>
            set({ itemUid: i.chosen ? null : i.uid, replaceItemUid: null }, `keep-item-${i.uid}`),
          { pressed: i.chosen, focus: `keep-item-${i.uid}` },
        ),
      );
    if (view.itemReplace) {
      copy.append(node('p', 'mu-requirements', 'Kept items of that kind are full. Replace:'));
      for (const i of view.itemReplace)
        copy.append(
          this.button(i.label, () => set({ replaceItemUid: i.uid }, `swap-item-${i.uid}`), {
            pressed: i.chosen,
            focus: `swap-item-${i.uid}`,
          }),
        );
    }
    copy.append(node('p', 'mu-help', view.caps));
    copy.append(
      this.button(
        `Remove ${view.name} from this pick`,
        () => {
          delete this.draft[ref];
          this.focus = null;
          this.rerender(`ride-${ref}`);
        },
        { focus: `unpick-${ref}` },
      ),
    );
  }

  renderRecord(copy, barracks, id) {
    const r = barracks.records.find((entry) => entry.id === id);
    if (!r) return;
    copy.append(node('h2', '', r.name), node('p', 'mu-help', r.line));
    copy.append(node('p', '', `Skills: ${r.skills.join(', ') || 'none yet'}`));
    copy.append(node('p', '', `Items: ${r.items.join(', ') || 'none yet'}`));
    if (r.kind === 'recruit') {
      copy.append(
        this.button(
          r.brought ? 'Bringing into the next NG+ run' : 'Bring into the next NG+ run',
          () => {
            const bring = this.meta.getNgPlus().bring.filter((other) => other !== r.id);
            if (!r.brought) bring.push(r.id);
            const result = this.meta.setNgPlusBring(bring);
            this.rerender(`bring-${r.id}`, result.ok ? null : ngPlusBlockText(result.reason));
          },
          { pressed: r.brought, focus: `bring-${r.id}`, disabled: !r.canBring },
        ),
      );
    } else copy.append(node('p', 'mu-help', 'Rides with their kit whenever they are in the run.'));
    const confirming = this.confirmRelease === r.id;
    copy.append(
      this.button(
        confirming ? `Release ${r.name} for good` : 'Release',
        () => {
          if (!confirming) {
            this.confirmRelease = r.id;
            return this.rerender(`release-${r.id}`);
          }
          const result = this.meta.releaseNgPlusVeteran(r.id);
          this.focus = null;
          this.confirmRelease = null;
          this.rerender(
            null,
            result.ok ? `${r.name} left the Barracks.` : ngPlusBlockText(result.reason),
          );
        },
        { focus: `release-${r.id}` },
      ),
    );
  }

  renderRideActions(copy, ride) {
    copy.append(node('h3', 'ng-heading', ride.title), node('p', 'mu-help', ride.lead));
    copy.append(node('p', '', ride.counts));
    if (ride.warnText) copy.append(node('p', 'mu-requirements', ride.warnText));
    if (ride.blockText) copy.append(node('p', 'mu-requirements', ride.blockText));
    const passing = !Object.keys(this.draft).length;
    return this.button(
      passing && this.confirmPass ? ride.confirmLabel : ride.commitLabel,
      () => {
        if (passing && !this.confirmPass) {
          this.confirmPass = true;
          return this.rerender('ng-commit');
        }
        this.confirmPass = false;
        const result = this.meta.chooseNgPlusRide(draftPicks(this.draft));
        if (result.ok) {
          this.draft = {};
          this.focus = null;
        }
        this.rerender(
          'ng-commit',
          !result.ok
            ? ngPlusBlockText(result.reason)
            : result.closed
              ? 'The Barracks is ready for the next NG+ run.'
              : 'Sent to the Barracks. Pick the rest, or tap Done.',
        );
      },
      { focus: 'ng-commit', cls: 'ng-commit', disabled: !ride.canCommit },
    );
  }
}
