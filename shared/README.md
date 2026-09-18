# shared/

Contracts that the web client (`server/resources/js`) and the native client
(`client/`) must agree on byte for byte. Owned by neither project; a change here
lands in the same PR as the change on both sides (`client.yml` runs on
`shared/**`, so drift fails CI).

| Path | Produced by | Consumed by | Checks |
|---|---|---|---|
| `fixtures/worldgen/` | `npm run fixtures:worldgen` in `server/` — golden chunks, heights, trees, islands, updrafts for five seeds | `client/test/world/` | byte-identical chunks and templates |
| `fixtures/protocol/` | `npm run fixtures:protocol` — every `protocol.ts` message as msgpackr bytes | `client/test/net/` | decode + byte-identical re-encode |
| `fixtures/physics/` | `npm run fixtures:physics` — swept AABB cases, rays, an 828-tick scripted walk | `client/test/physics/` | tick-for-tick equality |
| `data/` | (P2) `items.json`, `recipes.json` — the registry both clients load | both | — |

`npm run fixtures` regenerates all three. Never edit the fixture files by hand.
