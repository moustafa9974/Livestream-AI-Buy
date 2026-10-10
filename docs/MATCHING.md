# Matching, search and the live rail

## From detection to "Buy with PayPal"

1. A detection becomes **visible**, either after 2 sightings within 15 s, or immediately via the **fast lane** when the model is ≥ 0.9 confident and the item is clearly featured (prominence ≥ 0.6).
2. Right after the frame response (`after()` in the route), `matchNewlyVisible` runs:
   - **Pass 1 (fast):** search with a cached embedding, or text only. The card appears within a fraction of a second of the detection.
   - Then new labels get embedded in the background (`backfillEmbeddings`).
   - **Pass 2 (accurate):** detections that were matched on text alone are re-matched with their new embedding.
3. **Search** (`lib/search`) retrieves candidates. **Scoring** (`lib/matching/score.ts`) ranks them the same way whichever backend answered:
   - `0.8 × cosine + 0.2 × word coverage`, then category and colour adjustments.
   - **Exact** needs score ≥ `MATCH_EXACT_SCORE` **and no colour conflict**, so a black hoodie never sells the grey one.
   - **Similar** needs ≥ `MATCH_SIMILAR_SCORE`.
   - In text-only mode, the product must also be the same kind of thing: same leaf category, or the head noun matches.
4. **Channel3** (`lib/channel3`) adds up to 3 open-web "similar items". These are links, not checkouts. The card also shows "$X less than similar items" when the median similar price is higher than ours.
5. The **rail** (`lib/rail.ts`) is pushed to viewers over **SSE** (`/api/live/[slug]/rail`):
   - instantly via an in-process signal,
   - plus a 3-second version poll as a fallback, for updates made by another process (the Astropods watcher).

## Calibration (2026-10-10, real Gemini embeddings, seeded catalog)

| Seen by the camera | Best partner product | Score |
|---|---|---|
| black hooded sweatshirt | Everyday Oversized Hoodie: Black | 0.89 exact |
| wireless clip-on microphone | Clip-On Wireless Mic Kit | 1.00 exact |
| ceramic coffee mug | Speckled Stoneware Mug | 0.95 exact |
| grey hoodie | Hoodie: Heather Grey (not the black one) | 1.00 exact |
| silver laptop | none (not in catalog) | 0.66, below threshold |
| red baseball cap | Washed Canvas Cap (colour conflict) | 0.69, below threshold |

## Search backends

| Backend | When | Hybrid method |
|---|---|---|
| **Postgres** (default, always on) | `ELASTIC_ENABLED=false`, or whenever Elastic errors | Full-text OR-query ∪ pgvector nearest neighbours |
| **Elastic** | `ELASTIC_ENABLED=true` + `ELASTIC_URL` | BM25 `multi_match` + `knn` on a `dense_vector` (Gemini embeddings), merged in our code |

We don't use Elastic's RRF/linear retrievers: they're Enterprise-licensed and return 403 on the free Basic license. Plain `query` + `knn` work on every license, and the merge happens in `lib/matching/score.ts`.

### Elastic setup

- **Local (free):** needs Docker. `docker run -p 9200:9200 -e discovery.type=single-node -e xpack.security.enabled=false docker.elastic.co/elasticsearch/elasticsearch:9.1.0` (check the current tag on elastic.co). Then set `ELASTIC_URL=http://localhost:9200` and `ELASTIC_ENABLED=true`, and run `npm run search:index`.
- **Hosted demo:** Elastic Cloud 14-day trial, started in the **final week**. Create an API key, set `ELASTIC_URL` and `ELASTIC_API_KEY`, then run `npm run search:index`.

## Channel3 setup

Sign up at trychannel3.com/developers, redeem `PAYPAL-HACKATHON-2026`, and set `CHANNEL3_API_KEY`. Results are cached for 24 h per query, and calls are capped by `CHANNEL3_MAX_CALLS_PER_DAY`. A 402 (credits exhausted) or any error just hides the "similar items" section.

## Latency (measured 2026-10-10)

From a dev PC in Egypt against Neon US-East:
- each DB round trip ≈ 250–300 ms;
- Gemini vision ≈ 5–9 s (one free-tier outlier at 15 s);
- first buyable card ≈ 17 s after the item appeared.

Deployed in the **same region as the database** (Render Ohio + Neon us-east-2), DB time drops to milliseconds. The card should then land at about Gemini latency plus up to one sampling interval: **~5–10 s**. With the demo cache, it's about 1–2 s.
