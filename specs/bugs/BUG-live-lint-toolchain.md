# Baseline: ESLint cannot start with TypeScript 7

## Reproduction
On the untouched main baseline and the live feature branch:

```bash
npx eslint app/page.tsx components/map/main-map.tsx hooks/use-media-query.ts
```

Exit2: `typescript-eslint does not support TS 7.0.` The installed eslint-config-next16.3.8 embeds typescript-eslint8.71.0 with a peer range below6.1, while this project uses TypeScript7.0.2. It throws before parsing files. This was observed before the live implementation, so it is not a new lint failure.

## Scope / disposition
Not changing the project's compiler, lint config or Next version as a side effect of adding live buses. Typecheck and node:test remain executable and pass. Revisit the lint toolchain with a compatible TS API/updated parser in a separate change. Lint must be reported as blocked, not passed.
