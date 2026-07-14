# bindagt

SDK and CLI for [AGT-9303](https://bindagt.com), an open standard for permanent AI agent identity anchored to a domain you control.

```bash
npm install bindagt
```

## Verify an agent

```ts
import { verifyOnChain } from "bindagt";

const result = await verifyOnChain("agt://acme.com/support-bot");

console.log(result.valid);        // true
console.log(result.domain);       // "acme.com"
console.log(result.domainStatus); // "active"
console.log(result.anchoredAt);   // ISO timestamp
```

`verifyOnChain` reads the public registry directly over RPC — no API key, no Bindagt backend involved, no charge. It works even if `api.bindagt.com` is down; the registry is the L1 contract itself.

Two other verification modes are available for different trade-offs:

```ts
import { verify, verifyLocal } from "bindagt";

// verify(): goes through api.bindagt.com — faster (cached), needs the API up.
const a = await verify("agt://acme.com/support-bot");

// verifyLocal(): verify against a document you already have in hand, no network call.
const b = verifyLocal(agentDocument, expectedAgentId);
```

## What "verified" means

An agent identifier looks like `agt://domain/path`. Verifying one confirms:

- The `domain` root is registered and `active` on the AGT-9303 registry (an Ethereum L1 smart contract).
- The specific `path` under it has been anchored by whoever controls that domain's DNS.
- The record is immutable for its term — it can't be silently swapped out.

Full protocol details: [bindagt.com/docs](https://bindagt.com/docs).

## CLI

```bash
npm install -g bindagt
bindagt verify agt://acme.com/support-bot
bindagt status acme.com
```

Run `bindagt doctor` for a full list of commands and their status.

To register a domain from the CLI:

```bash
bindagt key generate            # creates and encrypts a local controlKey
bindagt register agt://acme.com/support-bot
bindagt status --watch acme.com # poll until DNS verification + L1 anchoring complete
```

`bindagt register` derives your `controlKey` from the keyfile created by `bindagt key generate` (secp256k1 by default; pass `--p256` to `key generate` for a P-256 key). Pass `--fast-lane` to `register` for priority processing (paid by Bindagt, not you — just a queue priority flag). Registration also works through the [dashboard](https://dashboard.bindagt.com/dashboard/domains/register) if you'd rather not manage a local key.

## Development

```bash
npm install
npm run build
npm test
```

## License

MIT
