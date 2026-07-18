const SUPPORTED_MARKETPLACE_HOSTS = ['tcgplayer.com', 'cardmarket.com', 'ebay.com'];

/** Accept only HTTPS links on an exact supported marketplace domain or one of its subdomains. */
export function isSupportedMarketplaceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      (url.hostname === 'prices.pokemontcg.io' ||
        SUPPORTED_MARKETPLACE_HOSTS.some(
          (hostname) => url.hostname === hostname || url.hostname.endsWith(`.${hostname}`),
        ))
    );
  } catch {
    return false;
  }
}
