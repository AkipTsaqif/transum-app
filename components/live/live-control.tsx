"use client";
import {
  LIVE_STALE_MS,
  type LiveStatus,
  type LiveVehicle,
} from "@/utils/types/live";
const labels: Record<LiveStatus, string> = {
  connecting: "Menghubungkan…",
  live: "Terhubung",
  reconnecting: "Menghubungkan ulang…",
  disconnected: "Terputus",
};

export function LiveControl({
  enabled,
  onToggle,
  status,
  vehicles,
  onPick,
  ages,
}: {
  enabled: boolean;
  onToggle: () => void;
  status: LiveStatus;
  vehicles: LiveVehicle[];
  onPick: (id: string) => void;
  ages: Record<string, number>;
}) {
  return (
    <section
      aria-label="Bus langsung"
      className="border-t border-white/15 px-4 py-2 text-white"
    >
      <button
        type="button"
        aria-pressed={enabled}
        onClick={onToggle}
        className="flex min-h-11 w-full items-center justify-between gap-2 rounded px-2 text-left text-sm hover:bg-white/10"
      >
        <span>
          Bus langsung{" "}
          <span className="text-[10px] text-cyan-200">eksperimental</span>
        </span>
        <span>{enabled ? "Matikan" : "Aktifkan"}</span>
      </button>
      {enabled && (
        <>
          <p role="status" className="px-2 text-xs text-white/70">
            {labels[status]} · {vehicles.length} bus teramati
            {status === "live" && vehicles.length === 0
              ? " · Mengumpulkan posisi bus…"
              : ""}
          </p>
          <p className="px-2 py-1 text-[11px] leading-snug text-white/50">
            Data diterima langsung dari Transjakarta. Tidak semua armada
            terpantau; waktu kedatangan belum tersedia.
          </p>
          <details className="mt-1 px-2 text-xs">
            <summary className="min-h-8 cursor-pointer py-2">
              Daftar bus ({vehicles.length})
            </summary>
            <div className="max-h-32 overflow-y-auto" aria-label="Pilih bus">
              {vehicles.map((v) => (
                <button
                  type="button"
                  key={v.id}
                  onClick={() => onPick(v.id)}
                  className="flex min-h-11 w-full items-center gap-2 rounded px-2 text-left text-xs hover:bg-white/10"
                >
                  <span
                    className="shrink-0 rounded px-1.5 py-1 font-bold"
                    style={{
                      backgroundColor: v.routeColor,
                      color: v.routeTextColor,
                    }}
                  >
                    {v.routeShortName}
                  </span>
                  <span className="font-bold">{v.label}</span>
                  <span className="truncate text-white/65">
                    {v.headsign || "Tujuan tidak tersedia"}
                  </span>
                  {(ages[v.id] ?? 0) >= LIVE_STALE_MS && (
                    <span className="ml-auto text-amber-200">Lama</span>
                  )}
                </button>
              ))}
            </div>
          </details>
        </>
      )}
    </section>
  );
}

export function LiveBusCard({
  vehicle,
  age,
  onClose,
}: {
  vehicle: LiveVehicle;
  age: number;
  onClose: () => void;
}) {
  return (
    <section
      aria-label={`Bus ${vehicle.label}`}
      className="max-h-[38dvh] overflow-y-auto rounded-lg bg-jakarta p-3 text-white shadow-xl ring-1 ring-white/15"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-bold">
            {vehicle.label} · {vehicle.routeId}
          </h2>
          <p className="text-sm">
            {vehicle.headsign || "Tujuan tidak tersedia"}
          </p>
        </div>
        <button
          type="button"
          aria-label="Tutup detail bus"
          onClick={onClose}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded hover:bg-white/10"
        >
          ✕
        </button>
      </div>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-white/60">Halte saat ini</dt>
        <dd>{vehicle.currentStop || "Tidak tersedia"}</dd>
        <dt className="text-white/60">Berikutnya</dt>
        <dd>{vehicle.nextStop || "Tidak tersedia"}</dd>
      </dl>
      <p
        className={`mt-2 text-xs ${age >= LIVE_STALE_MS ? "text-amber-200" : "text-cyan-200"}`}
      >
        Pembaruan diterima {Math.floor(age / 1000)} detik lalu
        {age >= LIVE_STALE_MS ? " · belum ada pembaruan baru" : ""}
      </p>
      <p className="mt-1 text-[11px] text-white/55">
        {vehicle.clock === "adjusted"
          ? "Jam perangkat diselaraskan relatif; waktu pengukuran belum terverifikasi."
          : vehicle.clock === "unverified"
            ? "Jam perangkat belum terverifikasi."
            : "Waktu penerimaan bukan jaminan usia posisi GPS."}
      </p>
    </section>
  );
}
