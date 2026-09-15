# shared/

Contracts that the web client (`server/resources/js`) and the native client
(`client/`) must agree on byte for byte. Owned by neither project; a change here
lands in the same PR as the change on both sides.

| Path | Produced by | Consumed by |
|---|---|---|
| `fixtures/worldgen/` | a script in `server/` (golden chunks per seed) | `client/` Dart tests |
| `protocol/` | JSON schema of `protocol.ts` messages + version | both |
| `data/` | `items.json`, `recipes.json` — the registry both clients load | both |

Nothing lives here yet; spike S2 in `docs/flutter-client-plan.md` fills in
`fixtures/worldgen/` first.
