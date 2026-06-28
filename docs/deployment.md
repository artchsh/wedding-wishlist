# Deployment

The app deploys to Cloudflare Workers via [`@opennextjs/cloudflare`](https://opennext.js.org/cloudflare)
(the OpenNext adapter), which converts the Next.js build into a Worker-compatible bundle in
`.open-next/`, then deploys it with Wrangler.

## Continuous deployment

Pushing to `master` triggers **Cloudflare Workers Builds** (configured in the Cloudflare
dashboard, not in this repo), which builds and deploys automatically. Typical turnaround is
1-3 minutes from push to live.

To check what's deployed: `npx wrangler deployments list` (shows timestamps + version IDs, no
direct way to see *which commit* without cross-referencing timestamps against `git log`).

### The Build command / Deploy command trap

Cloudflare Workers Builds has two **separate** dashboard settings:

- **Build command** — typically `npm run build` or similar
- **Deploy command** — must be `npm run deploy` (which runs
  `opennextjs-cloudflare build && opennextjs-cloudflare deploy`)

These are **not read from `wrangler.jsonc`** — Workers Builds does not honor custom build/deploy
config in the repo for this setting. If the Deploy command is left at its default
(`npx wrangler deploy`), it runs against whatever `.open-next/` happens to exist (or doesn't),
and deploys fail with:

```
Could not find compiled Open Next config, did you run the build command?
```

This already happened once. The fix is dashboard-only (Workers & Pages → this project → Settings
→ Build) — there is no CLI or config-file way to set it. If a deploy fails with that exact
message, that's the cause; ask whoever has dashboard access to check the Deploy command.

## Manual deploy

```bash
npm run deploy     # opennextjs-cloudflare build && opennextjs-cloudflare deploy
npm run preview     # same build, but runs wrangler dev/preview locally first
```

`npm run deploy` deploys directly to production — treat it like any other production deploy
(it's the same Worker the CI path deploys to).

## One-time Cloudflare account setup

These are already done for this project, kept here in case the bucket/account ever needs
recreating:

1. **Enable R2** on the Cloudflare account. This is an account-level toggle that **must be done
   in the dashboard** — `wrangler r2 bucket create` fails with `[code: 10042]` /
   "Please enable R2 through the Cloudflare Dashboard" on an account that hasn't enabled it yet,
   even though R2 has a free tier. No CLI workaround exists for this step.
2. `wrangler r2 bucket create wedding-wishlist-data`
3. Add the binding to `wrangler.jsonc` (already present):
   ```jsonc
   "r2_buckets": [{ "binding": "WISHLIST_BUCKET", "bucket_name": "wedding-wishlist-data" }]
   ```
4. `npm run cf-typegen` to regenerate `cloudflare-env.d.ts` with the new binding's type.

## Secrets vs. vars

- **Secrets** (e.g. `DISCORD_WEBHOOK_URL`) persist across deploys regardless of flags. Set with:
  ```bash
  wrangler secret put DISCORD_WEBHOOK_URL
  ```
  Pipe the value in or paste at the prompt — **never** pass it as a CLI argument or via `echo`
  (it would land in shell history / process listing).
- **Plain vars** in `wrangler.jsonc` get wiped on deploy unless `--keep-vars` is passed. This
  project doesn't currently use plain vars for secrets — only the `wrangler secret` mechanism.
- Locally, `next dev` reads `.env.local` (gitignored); `wrangler dev`/`opennextjs-cloudflare
  preview` reads `.dev.vars` (also gitignored) instead. Both need `DISCORD_WEBHOOK_URL` set
  separately if you want backups to work in each respective local mode. `.env.example` documents
  the variable with no real value, for onboarding.

## Custom domain

Production is served at the custom domain configured in the Cloudflare dashboard (Workers Routes
/ custom domains for this Worker) — not discoverable from this repo; ask whoever set it up, or
check the dashboard under this Worker's "Settings → Domains & Routes".
