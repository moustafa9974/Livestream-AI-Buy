/** Only Zapier's own hook host is accepted: the URL is user-supplied, so no SSRF. */
export function isZapierHookUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === "hooks.zapier.com" && u.pathname.startsWith("/hooks/catch/");
  } catch {
    return false;
  }
}
