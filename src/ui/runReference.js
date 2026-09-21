// Reference-only descriptions; no gameplay rules or reward amounts live here.
export function runReferenceEntries() {
  return [
    [
      'Rewinds',
      'Resources',
      'Charges last the run, not one battle.',
      'Return to the saved start of your player turn. +1 rewind charge after each act boss; unused charges carry forward.',
      'Check the remaining count before spending; all charges can be used in one battle.',
    ],
    [
      'Staves',
      'Resources',
      'Staff uses refill at the start of each battle.',
      'Healing strength and some staff ranges depend on MAG.',
      'After using a staff, a usable combat weapon is re-equipped for normal counterattacks.',
    ],
    [
      'Consumables',
      'Resources',
      'Uses are spent permanently and do not refill.',
      'Items are removed when their final use is spent. More can be acquired during the run.',
      'Check the effect and recipient before using. Outside battle, use them from Roster.',
    ],
    [
      'HP between battles',
      'Resources',
      'Damage carries forward between battles.',
      'Check your roster before advancing. Consumables and some service nodes provide recovery.',
      'Preview services on the current map; not every act contains every node type.',
    ],
    [
      'Route nodes',
      'Route',
      'Tap any node to preview it without advancing.',
      'Only connected available nodes can be entered. Advance commits the selection.',
      'Completed shops can be reopened while they remain your current node; stock is retained.',
    ],
    [
      'Services',
      'Route',
      'Villages buy, sell and forge; Churches offer recovery and promotion.',
      'Colosseums offer wagers and mercenaries. Ruins offer a pre-boss rest and limited wares.',
      'Inspect a node for its type. Service transactions and completed visits are saved.',
    ],
    [
      'Battle objectives',
      'Route',
      'Rout: defeat all enemies. Seize: defeat the boss and take the throne with a Lord.',
      'Escape: bring your Lords to the marked exits; other survivors retreat safely.',
      'Read the objective before moving. Winning does not always require defeating every enemy.',
    ],
    [
      'Par and turn bonus',
      'Rewards',
      'Par is the target turn count for the battle.',
      'Faster clears earn better turn ratings and bonus gold. Protect your army while weighing the bonus.',
      'The reward screen separates battle earnings already added from the reward you choose.',
    ],
    [
      'Reward choices',
      'Rewards',
      'Preview an item before choosing its recipient or upgrade target.',
      'Back returns to the previous reward step without spending it. Claimed rewards are saved.',
      'Unclaimed rewards stay available from the campaign map after saving and returning. Resolve them before advancing.',
    ],
  ].map(([name, type, ...referenceLines]) => ({ name, type, referenceLines }));
}
