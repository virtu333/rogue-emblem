// A rendering-only driver for the contract settlement page: the real ContractSettlementController,
// ContractSettlementMenu and engine commands over a real run, with JourneyPresentation standing in
// for the DOM (import tests/harness/JourneyTestSetup.js first). Built on EventDriver, so it drives
// the shipping callbacks (a button's onclick, the picker's apply) and reads the saved slot back,
// and holds no contract logic of its own. `reload()` reads only what a refresh would: the slot.
import { vi } from 'vitest';
import { saveRun } from '../../src/engine/RunManager.js';
import { ContractSettlementController } from '../../src/ui/ContractSettlementController.js';
import { EventDriver } from './EventDriver.js';

export class ContractDriver extends EventDriver {
  /** @param {{ run: object, nodeId: string }} options the run that owes, and the node it is held at */
  constructor({ run, nodeId }) {
    super({ run });
    this.node = run.nodeMap.nodes.find((n) => n.id === nodeId);
    saveRun(this.run, null, 1);
  }

  bind() {
    super.bind();
    this.scene._maybeOpenPendingContractSettlement = vi.fn();
    this.controller = new ContractSettlementController(this.scene);
  }

  /** The route map's opening of the page (`auto`: by itself; else a tap on the node or the chip). */
  open({ auto = false } = {}) {
    return this.controller.handle({ auto });
  }

  get menu() {
    return this.controller.menu;
  }
  get nodeNow() {
    return this.run.nodeMap.nodes.find((n) => n.id === this.node.id);
  }
}
