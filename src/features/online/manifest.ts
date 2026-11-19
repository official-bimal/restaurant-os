/**
 * The customer app: when someone adds a restaurant's ordering page to their home screen, it opens that restaurant's page, named
 * after the restaurant, with its own icon. Each restaurant has its own manifest (the staff app has a different one).
 */

export interface CustomerManifest {
  id: string;
  name: string;
  short_name: string;
  description: string;
  start_url: string;
  scope: string;
  display: "standalone";
  orientation: "portrait";
  background_color: string;
  theme_color: string;
  lang: string;
  categories: string[];
  icons: { src: string; sizes: string; type: string; purpose: "any" | "maskable" }[];
}

/** Cut a name to a length without leaving half a word or a dangling space. */
export function shorten(name: string, max: number): string {
  const clean = name.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace >= Math.floor(max / 2) ? cut.slice(0, lastSpace) : cut).trim();
}

export function customerManifest(p: { token: string; businessName: string; branchName: string }): CustomerManifest {
  const base = `/o/${p.token}`;
  const name = shorten(p.businessName, 45) || "Order online";
  return {
    id: base,
    name,
    // Home screens show about 12 characters under the icon.
    short_name: shorten(p.businessName, 12) || "Order",
    description: `Order from ${shorten(p.businessName, 60)} (${shorten(p.branchName, 40)}) for pickup or delivery.`,
    start_url: base,
    scope: base,
    display: "standalone",
    orientation: "portrait",
    background_color: "#121212",
    theme_color: "#121212",
    lang: "en",
    categories: ["food", "shopping"],
    icons: [
      { src: `${base}/icon/192`, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: `${base}/icon/512`, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: `${base}/icon/maskable-512`, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
