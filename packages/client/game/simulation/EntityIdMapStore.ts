/** Persistent packet-entity-id → client-world-entity-id mapping for bitecs deserializers. */
export class EntityIdMapStore {
  private readonly map = new Map<number, number>();

  /** Return the live map — pass the same reference to observer and SoA deserializers. */
  asMap(): Map<number, number> {
    return this.map;
  }

  /** Replace contents from a snapshotDeserialize return value (init or rollback anchor). */
  replace(source: Map<number, number>): void {
    if (source === this.map) return;
    this.map.clear();
    for (const [packetEid, worldEid] of source) {
      this.map.set(packetEid, worldEid);
    }
  }
}
