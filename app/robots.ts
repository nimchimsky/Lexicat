import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://lexic.cat";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Pàgines privades o amb estat de sessió: res a indexar.
        disallow: ["/api/", "/joc", "/killian", "/classic", "/resultats/", "/compte", "/mapa", "/benvingut", "/entrar"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
