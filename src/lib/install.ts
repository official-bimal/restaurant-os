/**
 * "Add to Home Screen": what to show a visitor so they can install the app. Pure functions, no browser access.
 *
 * Three cases, because the browsers really differ:
 *  - the page is already running as an installed app: say nothing;
 *  - the browser (Chrome, Edge, Samsung Internet on Android and desktop) offered an install prompt: show an Install button;
 *  - an iPhone or iPad (Safari has no install prompt at all): show the steps, because it can only be done by hand.
 */

export interface InstallEnv {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  /** Running as an installed app: display-mode standalone, or Safari's own `navigator.standalone`. */
  standalone: boolean;
  /** The browser has given us an install prompt to show (the `beforeinstallprompt` event). */
  canPrompt: boolean;
}

export type InstallHint =
  | { kind: "installed" }
  | { kind: "prompt" }
  | { kind: "ios-steps"; browser: "safari" | "other" }
  | { kind: "none" };

/** iPadOS 13+ reports itself as a Mac, but it has a touch screen. */
export function isIos(env: Pick<InstallEnv, "userAgent" | "platform" | "maxTouchPoints">): boolean {
  return /iPhone|iPad|iPod/.test(env.userAgent) || (env.platform === "MacIntel" && env.maxTouchPoints > 1);
}

export function installHint(env: InstallEnv): InstallHint {
  if (env.standalone) return { kind: "installed" };
  if (env.canPrompt) return { kind: "prompt" };
  if (isIos(env)) {
    // Only Safari can add to the home screen on iOS 16 and older; newer iOS lets Chrome and others do it from their share menu too,
    // so the steps are the same but the button is in a different place. Say which browser we think it is.
    const other = /CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(env.userAgent);
    return { kind: "ios-steps", browser: other ? "other" : "safari" };
  }
  return { kind: "none" };
}

/** A dismissed hint stays away for a while, then may come back (someone who said "not now" may change their mind). */
export const DISMISS_DAYS = 14;

export function isDismissed(dismissedAt: number | null, now: number, days: number = DISMISS_DAYS): boolean {
  return dismissedAt !== null && Number.isFinite(dismissedAt) && now - dismissedAt < days * 86_400_000;
}
