# Spike: Transjakarta live MQTT (2026-11-02)

## Question
Can the feed support a route-filtered live bus layer without invalid GPS or assuming all bus clocks are aligned?

## Result
Partially answered: live positions and exact route/stop joins are viable. ETA semantics, republication rights and reliable absolute source-age correction remain unverified. The research worker hit provider cooldown while finalizing; the parent preserved findings from its aggregate JSON, not a second capture.

## Findings / evidence
- MQTT3.1.1 over WSS `/mqtt`, `mqtt` subprotocol, `mqttjs_<random>` client ID, no credentials: CONNECT0, SUBACK0.
- Approximately 59.983 s sample: 3,073 messages, 172 distinct vehicle identities, 13,799,188 payload bytes (~230,052 bytes/s). Sample is NOT the total operating fleet.
- Raw coordinates: 3,061 valid nonzero pairs; 12 zero pairs; no nonzero pairs outside the sample's broad Jakarta bbox. Reject raw lat=0 OR lon=0 before considering snapped coordinates.
- Snapped-coordinate aggregate counters were accidentally accumulated three times (9,219 vs 3,073 messages); excluded from quality percentages. No claim based on that denominator.
- Route IDs/codes matched current baked GTFS on 2,966/3,073 messages (96.52%); unmatched codes included `9ST` and `SOE`. Exact trip IDs matched 2,920/3,073 (95.02%). This checkout uses an older 240-route GTFS: do not silently alias unknown routes.
- Stop IDs: 45,622/45,943 observations matched route-detail stop IDs (99.30%). Parent-stop extraction reported zero observations, not evidence the field is absent; parent joins remain unverified.
- Topic route/trip/vehicle segments agreed with payload for all 3,073 messages. Reported shape `/mobile_armada/<cell>/<route>/<trip>/<vehicle>`. Route-specific wildcard is plausible but NOT subscription-tested; production first slice uses a single shared subscriber.
- Per-vehicle receive interval observations (2,901 pairs): p10 0.1 s, p50 2.499 s, p90 5.982 s, max29.145 s. No exact duplicate payloads or backward source timestamps observed in this short window.
- `timestamp`: numeric epoch milliseconds for all messages. Receipt minus source seconds: p10 1.226, p50 2.361, p90 5.682; range -3.605 to 3,612.403. All159 vehicles observed twice advanced their timestamp. No evidence supports applying +7h or any other global correction.
- `last_update`: small numeric values, not established epoch time; no absolute-age semantics inferred. ETA fields exist but units and meaning were not established.
- HTTPS Date reference check failed, so local UTC clock has not been independently calibrated by this spike. The one-hour tail could be clock skew or old data; cannot decide solely from receipt age.

## Implications
- One shared VPS subscriber, not 230KB/s and an upstream connection per browser.
- Selected known GTFS route only, small normalized snapshots, at most one/second.
- Use receiver age for delivery freshness; deduplicate/ignore older source times so repeats do not refresh TTL. Source skew flags and progression-based relative correction must remain explicit, not presented as verified GPS measurement time.
- Initial operational thresholds: fade after30s; expire after90s. They are conservative UI policies based on this sample, not an upstream SLA.
- Reject old retained snapshots without progression evidence. No crowding or ETA UI in first slice.

## Prior art
https://git.rasyidanaf.com/0xrsydn/research/src/branch/main/transjakarta-live-data/analysis.md describes topic shape and a different capture; independent observations above take precedence. Official https://ppid.transjakarta.co.id/informasi/berkala licenses GTFS Static under CC BY4.0, not explicitly this MQTT stream.

## What was NOT explored
Route-specific subscription, full day coverage, midnight behavior, mixed clocks during device reboot, sample fleet representativeness, ETA units, public redistribution licence or production scaling.

## Recommendation
Proceed with an experimental opt-in route layer on a feature branch. Default disabled, no public deployment assumed. Keep data receipt age distinct from measurement age and mark unverified clocks. Validate operational behavior with synthetic deterministic tests and one bounded local sidecar smoke.
