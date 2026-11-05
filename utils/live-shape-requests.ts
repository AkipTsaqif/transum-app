/** Admission policy for the shape cache: prevent eviction/refetch storms. */
export class LiveShapeRequests {
  private retryAt = new Map<string, number>();
  private admitted = new Set<string>();
  constructor(
    private capacity = 40,
    private cooldownMs = 30_000,
  ) {}
  select(routes: readonly string[], now: number): string[] {
    const wanted = new Set(routes);
    for (const id of this.admitted)
      if (!wanted.has(id)) this.admitted.delete(id);
    for (const id of routes) {
      if (this.admitted.size >= this.capacity) break;
      this.admitted.add(id);
    }
    for (const [id, until] of this.retryAt)
      if (until <= now) this.retryAt.delete(id);
    return [...this.admitted].filter(
      (id) => (this.retryAt.get(id) ?? 0) <= now,
    );
  }
  failed(routeId: string, now: number) {
    this.retryAt.set(routeId, now + this.cooldownMs);
  }
}
