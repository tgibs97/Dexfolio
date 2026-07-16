# Dexfolio

A private, production-ready digital binder for collecting one physical Pokémon card for every National Pokédex species. Dexfolio starts with all 1,025 Generation I–IX species, can synchronize future species from PokéAPI, and tracks the card currently occupying each slot, card photos, and a restorable replacement history.

## Architecture

```text
React + TypeScript SPA
        │ same-origin /api
Cloudflare Worker (Hono + Zod)
        ├── D1: Pokémon reference data, slots, owned cards, history
        └── R2: private uploaded card images
```

- Vite builds the responsive React SPA. A single Worker serves its static assets and the API.
- D1 stores imported PokéAPI reference records separately from user-entered collection records.
- R2 objects use `cards/{pokemonId}/{uuid}.{extension}` keys, so replacement images never overwrite history.
- An isolated authentication layer issues role-signed, `HttpOnly`, `SameSite=Strict` cookies for password-authenticated admins and public read-only guests. It can later be replaced by a user table or Cloudflare Access without changing collection logic.
- Prepared D1 statements and Zod schemas protect the data boundary. Mutating requests require an admin session and a same-origin/allowed-origin check; guest write attempts are rejected by the Worker.

## Features

- Responsive card-grid and compact list binder views
- Password-free guest mode for viewing the binder, card details, history, progress, and pricing without collection or Admin access
- Search by name or exact Pokédex number; status/generation filters; number/name/date sorting
- Overall and per-generation progress
- Add, edit, replace, remove, restore, and inspect previous cards
- Mobile camera capture, local preview, large-photo optimization, 8 MB server limit, MIME and file-signature validation
- Cached Pokémon TCG set/card autocomplete with set-code and rarity autofill
- Explicit Admin-page Pokédex update checks and safe synchronization of newly released species
- Accessible native dialogs, labels, keyboard controls, loading/empty/error states, notifications, and destructive confirmations
- Local D1/R2 emulation, migration and seed commands, Cloudflare deployment config, and GitHub Actions CI/deployment

## Local development

Prerequisites: Node.js 22+, npm, and a free Cloudflare account for deployment. Local development does not touch production D1 or R2.

```bash
npm install
copy .dev.vars.example .dev.vars     # Windows
# cp .dev.vars.example .dev.vars     # macOS/Linux
npm run db:migrate:local
npm run db:seed:local
npm run dev
```

Open `http://localhost:5173`. The first `npm run dev` builds a static asset fallback, then starts Vite on 5173 and the API Worker on 8787. Vite proxies `/api` to the Worker. Local D1 and R2 data live under `.wrangler/state` and are ignored by Git.

The seed command downloads the first 1,025 `pokemon-species` records from the documented PokéAPI v2 endpoint, converts identifiers to display names, assigns canonical generation ranges, and upserts reference records and collection slots. Reference artwork uses the PokéAPI sprites repository URL and is browser/CDN cached.

After the initial seed, use **Admin → Update Pokédex** to check for newly released species. Synchronization is always an explicit action: it inserts only missing National Pokédex IDs, creates their empty binder slots, and never overwrites or deletes existing Pokémon or collection records. Generation filters are generated from the database, so a newly synchronized generation appears automatically.

## Commands

| Command                     | Purpose                                                                |
| --------------------------- | ---------------------------------------------------------------------- |
| `npm run dev`               | Build fallback assets and start the Vite UI plus local Worker          |
| `npm run build`             | Create the production SPA in `dist/`                                   |
| `npm run check`             | Formatting, lint, type checks, all tests, and production build         |
| `npm test`                  | Browser component tests plus Cloudflare Worker/D1/R2 integration tests |
| `npm run db:migrate:local`  | Apply migrations to local D1                                           |
| `npm run db:seed:local`     | Import the complete Pokédex into local D1                              |
| `npm run db:migrate:remote` | Apply migrations to production D1                                      |
| `npm run db:seed:remote`    | Import/upsert the complete Pokédex in production D1                    |
| `npm run deploy`            | Build and deploy manually through Wrangler                             |

## Cloudflare production setup

1. Authenticate and create resources:

   ```bash
   npx wrangler login
   npx wrangler d1 create personal-pokedex-tracker
   npx wrangler d1 create personal-pokedex-tracker-preview
   npx wrangler r2 bucket create personal-pokedex-card-images
   npx wrangler r2 bucket create personal-pokedex-card-images-preview
   ```

2. Replace both all-zero D1 IDs in `wrangler.jsonc` with the IDs returned by Cloudflare. Set `ALLOWED_ORIGIN` to the final `https://…` application origin. The production and preview bucket names are already declared.

3. Configure Worker secrets interactively. Use a unique password and a random session secret of at least 32 characters:

   ```bash
   npx wrangler secret put ADMIN_PASSWORD
   npx wrangler secret put SESSION_SECRET
   ```

   Optionally create a free API key at the [Pokémon TCG Developer Portal](https://dev.pokemontcg.io/) for higher autocomplete rate limits. Suggestions work at reduced limits without one:

   ```bash
   npx wrangler secret put POKEMON_TCG_API_KEY
   ```

   Never put either value in `wrangler.jsonc`, `.dev.vars.example`, GitHub Actions YAML, or Git.

4. Initialize the database and perform the first deployment:

   ```bash
   npm run db:migrate:remote
   npm run db:seed:remote
   npm run deploy
   ```

5. If using a custom domain, add it in Workers & Pages → this Worker → Settings → Domains & Routes, then update `ALLOWED_ORIGIN` and deploy again.

## GitHub deployment

The workflow in `.github/workflows/ci-deploy.yml` runs the full check suite for every pull request and every push to `main`. A successful `main` build applies pending D1 migrations and deploys the Worker plus static assets automatically.

Create these GitHub repository secrets:

- `CLOUDFLARE_ACCOUNT_ID`: the account ID shown in the Cloudflare dashboard.
- `CLOUDFLARE_API_TOKEN`: a scoped token able to edit Workers, D1, and R2 for this account.

Use GitHub's protected `production` environment to require approval if desired. Cloudflare secrets (`ADMIN_PASSWORD` and `SESSION_SECRET`) remain stored by Cloudflare and are not redeclared on each deploy.

Pull requests are fully built and tested. Public preview URLs are intentionally not enabled by default because each preview needs an isolated D1 database, R2 bucket, and secrets. To add previews safely, create a Wrangler `preview` environment bound to the preview resources and add a PR workflow using `wrangler deploy --env preview`; do not point previews at production storage.

## Data and lifecycle

`pokemon` contains general reference records. `collection_slots` owns the stable binder position and current-card pointer. `owned_cards` contains user-entered records; a partial unique index permits only one current card per Pokémon.

Replacing or restoring first archives the outgoing card, then switches the slot pointer in one D1 batch. Removing a card archives it with a `removed` reason and returns the slot to Missing. Images for archived cards remain in R2 so history stays viewable and restorable. Editing an image only replaces the image belonging to that same card record and removes the superseded R2 object after the database update succeeds.

## Security notes

- Do not expose the app until `ADMIN_PASSWORD`, `SESSION_SECRET`, and the final `ALLOWED_ORIGIN` are configured.
- Admin and guest sessions expire after 14 days. Sign-out or exiting guest mode clears the cookie. All binder data and R2 image routes require one of these signed sessions.
- Guest authorization is enforced by the Worker: guests may use read endpoints, but all writes and every `/api/admin/*` endpoint return `403`, even if called outside the UI.
- Uploaded SVG and arbitrary files are rejected. JPEG, PNG, WebP, and GIF uploads are limited to 8 MB and checked by content signature.
- Security headers include a restrictive Content Security Policy, `nosniff`, no-referrer policy, and HSTS on HTTPS.
- D1 access uses bound prepared values; user-selected sorting maps to fixed SQL fragments.
- The single shared password is appropriate for the initial owner-only deployment. Before multi-user use, add per-user identities, password hashing/account recovery or Cloudflare Access, ownership columns, authorization checks, login rate limiting, and audit logging.

## Testing

UI tests cover collected/missing rendering, search/filter controls, and Admin maintenance actions. Worker tests run inside Cloudflare's Workers Vitest runtime, apply the real D1 migration, and exercise authentication, database search/filter behavior, Pokédex synchronization, add, edit, replace, restore, remove, history retention, and disguised upload rejection. Run everything with:

```bash
npm run check
```

Pokémon names and artwork metadata are sourced from [PokéAPI](https://pokeapi.co/docs/v2). Optional set, card number, and rarity suggestions are sourced on demand through the [Pokémon TCG API](https://docs.pokemontcg.io/); catalog failures never prevent manual entry. Pokémon is a trademark of Nintendo/Creatures Inc./GAME FREAK inc.; this personal project is unaffiliated and does not include official card frames, logos, or scanned assets.
