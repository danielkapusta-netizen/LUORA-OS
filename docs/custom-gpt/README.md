# Connecting a Custom GPT to the pricing dashboard

The Custom GPT reads the product mapping and saves its research through two API calls described in [`openapi.json`](openapi.json). What it saves only fills the **Recommended price** column on the Pricing page. Nothing is published to a marketplace until a person presses Update. The API itself is described in [`../pricing-research.md`](../pricing-research.md).

## 1. Set the token on the Worker

Generate a random string of at least 32 characters (for example `openssl rand -base64 36`) and store it:

```sh
wrangler secret put PRICING_RESEARCH_API_TOKEN
```

The token allows reading the product/offer mapping and importing recommendations. It cannot change a price. Keep it out of the GPT's instructions and out of chat.

## 2. Check it works

```sh
curl -s -H "Authorization: Bearer $PRICING_RESEARCH_API_TOKEN" \
  https://luora-os.danielkapusta.workers.dev/api/pricing/recommendations/catalog | head -c 600
```

You should see JSON with `accounts` and `products`. `503` means the secret is not set on the deployed Worker, `401` means the token is wrong.

## 3. Create the GPT

1. In ChatGPT: **Explore GPTs → Create → Configure**.
2. **Instructions:** paste the part of [`instructions.md`](instructions.md) below its line.
3. **Actions → Create new action:** paste the whole of `openapi.json` into the schema box.
4. **Authentication:** API key, auth type **Bearer**, and the token from step 1.
5. Save it as private (**Only me**).

## 4. Try it small

Ask it to research two products on one marketplace only. Then open **Pricing** for that marketplace and check that the Recommended price, rationale and evidence links appear on those rows. Check one price by hand against the marketplace.

## 5. Schedule it

Whether a scheduled ChatGPT task can use a Custom GPT's actions has to be checked in your ChatGPT plan; I could not confirm it. If it cannot, keep the GPT for on-demand runs and have the scheduled job write the JSON file, then upload it with `node scripts/import-pricing-research.mjs --file research.json` (see `../pricing-research.md`).

## Limits to know

- A catalog page holds 50 products with their offers. If ChatGPT cuts a response short, tell us: a smaller page size is a small change on the server.
- A batch holds at most 100 recommendations. One rejected record (422) rejects the whole batch and names the record.
- Research older than 48 hours, or made at a Luora price that has since changed, is shown but its "Use price" button asks for a recheck.
- To rotate the token, run `wrangler secret put` again and update the GPT's API key.
