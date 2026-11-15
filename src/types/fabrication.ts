/** One file of an order as the cloud describes it in the wait's data. */
export interface OrderAsset {
  as: string;
  sha256: string;
  size: number;
}

/** A cloud order read from its escalation row. */
export interface FabricationOrder {
  orderId: string;
  product: string;
  quantity: number;
  /** The key the site resolves the cloud wait with. */
  signalKey: string;
  assets: OrderAsset[];
}

/** A file of the order on the site's disk. */
export interface StagedAsset extends OrderAsset {
  name: string;
}

/** What `fabricate` starts with: the order and where its files are. The workflow id is the cloud escalation id. */
export interface FabricateInput extends Omit<FabricationOrder, 'assets'> {
  escalationId: string;
  assets: StagedAsset[];
}

/** What the site tells the cloud when the order is done. */
export interface FabricationOutcome extends Record<string, unknown> {
  completed: boolean;
  units: number;
  site: string;
  notes?: string;
}
