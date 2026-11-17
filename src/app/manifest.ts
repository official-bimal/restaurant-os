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
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#f6f5f2",
    theme_color: "#0f857a",
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png", purpose: "any" },
    ],
  };
}
