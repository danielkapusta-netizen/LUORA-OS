# Marketplace research recommendations

The Empik, HEBE and Allegro pricing tabs show Product → Current marketplace price / Update → Recommended price → Rationale → Shopify price. Shopify and Von Halsky keep their existing columns.

“Last researched” appears below each recommendation, in Europe/Warsaw time. Source labels that occur in the rationale become competitor links; other sources appear below the rationale. Rationale is plain text, never HTML or Markdown. Research is shown in the language supplied by the researcher; interface labels support English and Polish.

“Use price” only fills that offer’s existing editable field. The user must press Update (or the existing bulk-update button) to publish. Imports write only `pricing_recommendations`; they never call marketplace adapters or change offer prices. Only `change_price` records offer a copy button. Research older than 48 hours or whose observed Luora price differs from the current stored offer price needs a recheck before the button is offered. Manual price editing remains available.

## Deployment

1. Apply the additive D1 migration: `pnpm db:migrate:remote`. It creates a separate recommendations table and leaves existing prices intact. Apply before deploying this worker.
2. Deploy the worker through the existing release process, after CI passes.
3. Generate a separate random token of at least 32 characters. Store it as the Cloudflare Worker secret `PRICING_RESEARCH_API_TOKEN` using `wrangler secret put PRICING_RESEARCH_API_TOKEN`. Give the research runner the same secret through its secure environment. Never put it in source, client-side variables, screenshots, reports or the saved automation prompt.
4. Check the catalog endpoint, import a verified test recommendation, and confirm the pricing row before enabling daily imports.

The API returns 503 until the token is configured, 401 without a valid bearer token, and sends `Cache-Control: no-store`. This credential grants access only to catalog mapping/pricing reads and recommendation imports. Existing browser permissions still protect the pricing screen and manual price publication. Rotate the token by replacing it in both environments; leaving it blank disables API access.

## Read product/offer mappings

`GET /api/pricing/recommendations/catalog` with `Authorization: Bearer <secret>` returns:

```json
{
  "accounts": [{ "id": "empik-account-id", "marketplace": "empik", "name": "Luora" }],
  "products": [{
    "id": "internal-product-id",
    "shopifyVariantId": "gid://shopify/ProductVariant/123",
    "sku": "CELIMAX-30", "ean": "1234567890123", "name": "Example serum 30 ml", "stock": 12,
    "listings": [{ "id": "internal-offer-id", "accountId": "empik-account-id", "marketplace": "empik", "externalId": "offer-123", "price": "69.90", "currency": "PLN", "active": true }]
  }],
  "nextCursor": null
}
```

Follow `?after=<nextCursor>` until `nextCursor` is null (50 products per page). This is a mapping of imported Shopify variants, **not an authoritative list of currently active Shopify products**. The daily research must still fetch active products from Shopify and match exact variant IDs and pack sizes. Do not match by name alone. Synthetic/missing SKUs are safe because matching uses the Shopify variant ID. Select the correct marketplace account explicitly, especially when multiple accounts exist. The catalog exposes no credentials, orders or customer data.

## Import recommendations

`POST /api/pricing/recommendations`, bearer token, `Content-Type: application/json`:

```json
{
  "runId": "luora-research-2026-10-30",
  "recommendations": [{
    "shopifyVariantId": "gid://shopify/ProductVariant/123",
    "accountId": "empik-account-id",
    "marketplace": "empik",
    "listingId": "internal-offer-id",
    "status": "change_price",
    "recommendedPrice": "58.89",
    "observedLuoraPrice": "69.90",
    "researchedAt": "2026-10-30T09:14:00+01:00",
    "rationale": "Main Empik 62.99 zł; lowest SkinKo 58.90 zł; Luora 69.90 zł. Test the proposed price if margin permits; verify main seller after the change.",
    "sources": [
      { "label": "Main Empik", "url": "https://www.empik.com/example,p123,kosmetyki-p" },
      { "label": "SkinKo", "url": "https://www.empik.com/example,p123,kosmetyki-p#offers" }
    ]
  }]
}
```

The example prices and links illustrate the contract; they are not current market evidence. `researchedAt` must be the actual observation timestamp, including a timezone, not the upload time. Prices are positive gross PLN amounts as strings with two decimals, maximum 99999.99. Only `change_price` has a non-null recommended price; it requires an exact offer, observed Luora price and source evidence. Sources must be HTTPS links on the researched marketplace (`empik.com` / `empik.pl`, `allegro.pl`, `hebe.pl`, including their subdomains).

Other statuses:

| Status | Use |
| --- | --- |
| `keep_price` | Verified competitive price/placement; proposed price null. |
| `fix_placement` | Placement, matching or offer activation issue needs investigation; proposed price null. |
| `add_listing` | Verified missing product; listing ID and proposed price null. |
| `needs_review` | Blocked page, incomplete seller evidence, uncertain product match; proposed price null. |

Keep all fields present, using null where appropriate. Failed or ambiguous checks must produce `needs_review` with the limitation in the rationale, never a fabricated price or a claim that an inaccessible listing is missing. Refresh and retry marketplace pages before recording a technical gap. A later failed check should replace an older actionable proposal so the UI reflects current uncertainty.

Each batch accepts 1–100 unique product/account records, at most 512 KiB. Unknown variants, mismatched/disabled accounts, offers belonging to other products/accounts, add-listing actions where an offer already exists and non-PLN price proposals are rejected with 422 before any writes. A batch commits atomically. Only a **strictly newer observation timestamp** replaces an existing product/account recommendation. Replaying the same batch, or receiving an older run late, cannot overwrite newer research. Equal timestamps preserve the first accepted record; a corrected observation needs a newer timestamp.

Success: `{ "received": 87, "applied": 85, "ignoredOlderOrEqual": 2 }`. Other responses: 400 invalid JSON/cursor, 413 body too large, 415 content type, 500 storage failure (retry the same payload). Imports with more than 100 records need multiple batches; previously accepted batches remain if a later batch fails.

## Research runner

Set `LUORA_OS_URL` and `PRICING_RESEARCH_API_TOKEN` securely in the runner environment, then:

```sh
node scripts/import-pricing-research.mjs --catalog > catalog.json
node scripts/import-pricing-research.mjs --file verified-research.json
```

The uploader follows catalog pagination, splits imports into batches of 100, refuses redirects so the bearer token is not forwarded to a different origin, and never prints the token. Reusing a file safely resumes an interrupted upload. API validation remains authoritative.

The existing daily 09:00 Europe/Warsaw task can upload the same evidence used in its workbook and priority overview once the deployed endpoint and secret are configured. Keep the full report and coverage gaps. Do not silently turn this feature into automatic repricing, and do not claim that lower prices guarantee top-offer/main-seller placement: check the resulting seller position after a manual update.
