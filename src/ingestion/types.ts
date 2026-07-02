/** A listing as extracted from a source, before normalization/matching. */
export interface RawListing {
  /** Stable id from the source (Lystos listing id). Used for idempotency. */
  sourceId: string;
  source: string;
  url?: string;
  title?: string;
  price?: number;
  zone?: string;
  propertyType?: string;
  rooms?: number;
  sqm?: number;
  ownerName?: string;
  ownerPhone?: string;
  /** true = published by a private owner ("particular"), false = agency, undefined = unknown */
  isPrivateOwner?: boolean;
  raw: unknown;
}

export interface IngestionSource {
  readonly name: string;
  fetchNewListings(): Promise<RawListing[]>;
}
