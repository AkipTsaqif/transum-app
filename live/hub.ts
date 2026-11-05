import type {
  LiveSnapshot,
  LiveStatus,
  LiveScope,
  LiveRouteStyle,
} from "../utils/types/live";
import { liveScopeQuery } from "../utils/live-scope";
import { LiveVehicleStore } from "../utils/transjakarta-live";

/** MQTT adapter boundary permits lifecycle tests with no external broker. */
export interface LiveTransport {
  stop(): void;
}
export interface TransportEvents {
  ready(): void;
  message(payload: unknown, retained: boolean): void;
  failed(): void;
}
export type ConnectLive = (events: TransportEvents) => LiveTransport;

/** Exactly one upstream connection per sidecar, started on demand, no history. */
export class LiveHub {
  private viewers = 0;
  private transport: LiveTransport | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private idle: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private attempt = 0;
  private status: LiveStatus = "disconnected";
  private store: LiveVehicleStore;
  constructor(
    readonly routes: ReadonlyMap<string, string>,
    private connect: ConnectLive,
    private options: {
      now?: () => number;
      idleMs?: number;
      retryMs?: number;
      random?: () => number;
      styles?: ReadonlyMap<string, LiveRouteStyle>;
    } = {},
  ) {
    this.store = new LiveVehicleStore(routes, undefined, options.styles);
  }
  get clientCount() {
    return this.viewers;
  }
  private now() {
    return (this.options.now ?? Date.now)();
  }
  acquire(): () => void {
    this.viewers++;
    if (this.idle) {
      clearTimeout(this.idle);
      this.idle = null;
    }
    if (!this.transport && !this.retry) this.start();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.viewers--;
      if (!this.viewers)
        this.idle = setTimeout(
          () => this.stop(),
          this.options.idleMs ?? 10_000,
        );
    };
  }
  snapshot(scope: string | LiveScope): LiveSnapshot {
    const filter =
      typeof scope === "string" ? { routeId: scope, bounds: null } : scope;
    const now = this.now();
    return {
      routeId: filter.routeId,
      scopeKey: liveScopeQuery(filter),
      serverTime: now,
      status: this.status,
      vehicles: this.store.snapshot(filter, now),
    };
  }
  private start() {
    const gen = ++this.generation;
    this.status = this.attempt ? "reconnecting" : "connecting";
    // Connectors must report asynchronously, as MQTT.js does.
    try {
      this.transport = this.connect({
        ready: () => {
          if (gen === this.generation) {
            this.status = "live";
            this.attempt = 0;
          }
        },
        message: (p, retained) => {
          if (gen === this.generation && this.status === "live")
            this.store.ingest(p, this.now(), retained);
        },
        failed: () => this.failed(gen),
      });
    } catch {
      this.failed(gen);
    }
  }
  private failed(gen: number) {
    if (gen !== this.generation) return;
    ++this.generation;
    this.transport?.stop();
    this.transport = null;
    this.status = "reconnecting";
    if (!this.viewers) {
      this.stop();
      return;
    }
    const base = this.options.retryMs ?? 1000;
    const delay = Math.min(30_000, base * 2 ** Math.min(this.attempt++, 5));
    const jitter = 0.8 + (this.options.random ?? Math.random)() * 0.4;
    this.retry = setTimeout(
      () => {
        this.retry = null;
        if (this.viewers) this.start();
      },
      Math.min(30_000, delay * jitter),
    );
  }
  stop() {
    ++this.generation;
    if (this.idle) clearTimeout(this.idle);
    if (this.retry) clearTimeout(this.retry);
    this.idle = this.retry = null;
    this.transport?.stop();
    this.transport = null;
    this.status = "disconnected";
    this.store.clear();
  }
}
