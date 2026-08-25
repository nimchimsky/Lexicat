/** @type {import('next').NextConfig} */

// Cap CSP d'execució encara (els scripts inline de Next exigirien nonce via
// middleware): primer es corregirà en mode report-only, i quan el registre
// estigui net es passarà a Content-Security-Policy sec.
const cspReportOnly = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "base-uri 'self'",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  // HSTS només té efecte en producció (HTTPS a Vercel); en local és inofensiu.
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
  { key: "Content-Security-Policy-Report-Only", value: cspReportOnly },
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    const base = [{ source: "/(.*)", headers: securityHeaders }];

    // Previews de Vercel: mai indexables (robots.txt/sitemap apunten a prod,
    // però la capçalera mana sobre qualsevol crawler que arribi al preview).
    if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") {
      base[0].headers.push({ key: "X-Robots-Tag", value: "noindex, nofollow" });
    }

    return [
      ...base,
      {
        // Els SVG del mapa porten contingut versionat al nom de fitxer:
        // cache immutable, estalviem el revalidatge dels ~425 KB.
        source: "/mapa/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
          ...securityHeaders.filter((h) => h.key !== "Strict-Transport-Security"),
        ],
      },
    ];
  },
};

export default nextConfig;
