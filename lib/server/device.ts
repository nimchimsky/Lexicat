// Classe de dispositiu a partir de l'User-Agent (gruesa, sense dependències).
// Només per registre: mobile/tablet/desktop.

export function deviceClassFromUserAgent(ua: string | null | undefined): "mobile" | "tablet" | "desktop" {
  if (!ua) return "desktop";
  const s = ua.toLowerCase();
  if (/ipad|tablet|playbook|silk|(android(?!.*mobile))/.test(s)) return "tablet";
  if (/mobi|iphone|ipod|android.*mobile|windows phone/.test(s)) return "mobile";
  return "desktop";
}
