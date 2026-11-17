/** One eye of a prescription. */
export interface Eye {
  sphere: number;
  cylinder: number;
  axis: number;
  add: number;
}

/** One file of an order as the cloud describes it in the wait's data. */
export interface OrderAsset {
  as: 'frame' | 'prescription';
  sha256: string;
  size: number;
}

/** A cloud order read from its escalation row. */
export interface ProductionOrder {
  orderId: string;
  frameStyle: string;
  lensMaterial: string;
  coating: string;
  lotNumber: string;
  prescription: { right: Eye; left: Eye; pd: number };
  /** The key the site resolves the cloud wait with. */
  signalKey: string;
  assets: OrderAsset[];
}

/** A file of the order on the site's disk. */
export interface StagedAsset extends OrderAsset {
  name: string;
}

/** What `makeGlasses` starts with: the order and where its files are. The workflow id is the cloud escalation id. */
export interface MakeGlassesInput extends Omit<ProductionOrder, 'assets'> {
  escalationId: string;
  assets: StagedAsset[];
}

/** What the site tells the cloud when the order is done. */
export interface ProductionOutcome extends Record<string, unknown> {
  completed: boolean;
  site: string;
  binKey?: string;
  destination?: string;
  notes?: string;
}
