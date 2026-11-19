import type { MetadataRoute } from "next";

/**
 * Makes the app installable ("Add to Home Screen"). On iPhone and iPad, alerts only work for an installed app,
 * and on Android and desktop it gives a full-screen window that opens from the home screen or taskbar.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Restaurant OS",
    short_name: "Restaurant OS",
    description: "Orders, kitchen and billing for restaurants and cafes.",
    id: "/",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#f6f5f2",
    theme_color: "#4f46e5",
    lang: "en",
    categories: ["business", "productivity"],
    icons: [
      { src: "/pwa/icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa/icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa/icon/maskable-512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // Long-press the app icon on Android for these.
    shortcuts: [
      { name: "Orders", url: "/orders", icons: [{ src: "/pwa/icon/192", sizes: "192x192", type: "image/png" }] },
      { name: "Kitchen", url: "/kitchen", icons: [{ src: "/pwa/icon/192", sizes: "192x192", type: "image/png" }] },
      { name: "Quick order", url: "/quick", icons: [{ src: "/pwa/icon/192", sizes: "192x192", type: "image/png" }] },
    ],
  };
}
