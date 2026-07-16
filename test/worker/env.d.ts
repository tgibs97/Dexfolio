declare module 'cloudflare:workers' {
  interface ProvidedEnv {
    DB: D1Database;
    CARD_IMAGES: R2Bucket;
    ASSETS: Fetcher;
    ADMIN_PASSWORD: string;
    SESSION_SECRET: string;
    ALLOWED_ORIGIN: string;
    TEST_MIGRATIONS: D1Migration[];
  }
}
export {};
