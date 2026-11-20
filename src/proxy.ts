import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic check only: send visitors without a session cookie to /login.
 * Real verification happens in requireTenant() on the server for every page and action.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // Online ordering (/o/<token>) is public the same way: the long random token in the URL is the credential.
  // Public guest pages: the secret table token in the URL is the credential, not a staff login.
  // Delivery links work the same way: the long random token in the URL is the credential.
  // Dish photos are public: they are shown on the guest menu.
  // The install files (manifest, icons, service worker) are fetched by the phone itself, without a session.
  const installFiles = ["/manifest.webmanifest", "/icon", "/apple-icon", "/sw.js", "/offline"];
  // The scheduled alert check carries its own secret instead of a session.
  // The customer-facing screen (/display/<token>) works the same way: its secret link is the credential, and it shows only one bill at a time.
  // The public landing page.
  if (pathname === "/") return NextResponse.next();
  if (installFiles.includes(pathname) || pathname.startsWith("/pwa/") || pathname.startsWith("/api/cron/")) return NextResponse.next();
  if (pathname.startsWith("/login") || pathname.startsWith("/t/") || pathname.startsWith("/o/") || pathname.startsWith("/pay/") || pathname.startsWith("/api/pay/") || pathname.startsWith("/track/") || pathname.startsWith("/rider/") || pathname.startsWith("/dish/") || pathname.startsWith("/display/") || pathname.startsWith("/api/display/")) {
    return NextResponse.next();
  }
  if (!request.cookies.has("ros_session")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
