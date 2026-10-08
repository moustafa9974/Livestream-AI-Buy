# Seen

> If it's on screen, it's shoppable, and the creator gets paid.

An AI watches a creator's video or live stream, recognizes the products on screen, pins one-tap PayPal buy buttons next to the video, and pays the creator a commission through PayPal Payouts.

**Status:** in development for the PayPal "Build What's Next with PayPal and AI" hackathon. The full README (demo link, architecture, sponsor table, $0 breakdown) is coming in Phase 7.

## Local setup (runs for $0)

Prerequisites: Node 22+, and Docker (or a free Neon Postgres database).

```bash
npm install
cp .env.example .env          # every variable is documented in the file
npm run db:up                 # Postgres + pgvector via Docker (skip if using Neon)
npm run db:deploy             # apply migrations
npm run db:seed               # demo creator "Maya Makes", catalog, past sales
npm run dev                   # http://localhost:3000
```

`/api/health` reports DB status and which integrations are on, and why the others are off.

## Tests

```bash
npm test
npm run typecheck && npm run lint
```

## License

MIT
