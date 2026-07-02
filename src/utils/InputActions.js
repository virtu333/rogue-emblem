// Device-independent input action vocabulary.
//
// Both the gamepad reader (GamepadReader.js) and, eventually, the mobile touch
// overlay emit these abstract actions onto a shared bus. Scenes subscribe to the
// bus *regardless of input device* and decide what each action means in context
// (e.g. NAVIGATE moves the battle grid cursor in PLAYER_IDLE but moves the action
// menu focus in UNIT_ACTION_MENU). This is the seam that keeps controller support
// from being coupled to `isMobileInput` or to Phaser's scene-owned gamepad plugin.

export const InputAction = {
  NAVIGATE: 'input:navigate', // payload: { dx, dy } in {-1,0,1}; auto-repeats (DAS/ARR) while held
  CONFIRM: 'input:confirm', // A / south
  CANCEL: 'input:cancel', // B / east
  DANGER: 'input:danger', // X / west — toggle enemy danger zone
  ROSTER: 'input:roster', // Y / north — open roster
  PREV_UNIT: 'input:prevUnit', // L1 — cycle to previous un-acted unit
  NEXT_UNIT: 'input:nextUnit', // R1 — cycle to next un-acted unit
  INSPECT: 'input:inspect', // L2 — inspect / enemy range (the right-click affordance)
  PAUSE: 'input:pause', // Start — pause menu
};

// The single game.events channel the bus rides on. Listeners receive (action, payload).
export const INPUT_ACTION_EVENT = 'input:action';
