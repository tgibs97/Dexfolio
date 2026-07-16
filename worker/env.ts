export interface Env {
  DB: D1Database;
  CARD_IMAGES: R2Bucket;
  ASSETS: Fetcher;
  ADMIN_PASSWORD: string;
  SESSION_SECRET: string;
  ALLOWED_ORIGIN: string;
  POKEMON_TCG_API_KEY?: string;
}
