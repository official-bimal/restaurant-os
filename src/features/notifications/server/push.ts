import { sendNotification, setVapidDetails } from "web-push";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/auth";
import { can, type Permission } from "@/server/permissions";
import { DomainError } from "@/server/errors";

/**
 * Background alerts (Web Push) so a phone or computer is told even when the app is closed.
 *
 * Opt-in per device. The messages carry only a short line ("Table T3 sent an order"), never customer details.
 * Sending never blocks or breaks the action that caused it: failures are swallowed, and a subscription the
 * push service says is gone is removed. With no VAPID keys configured, everything here quietly does nothing.
 */

export interface PushPayload {
  title: string;
  body: string;
  /** A path inside the app, opened when the notification is tapped. */
  url: string;
  /** A newer notification with the same tag replaces the older one. */
  tag?: string;
}

type Sender = (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string) => Promise<unknown>;

let customSender: Sender | null = null;
/** Tests plug in a fake sender so nothing leaves the machine. */
export function setPushSender(sender: Sender | null) {
  customSender = sender;
}

export function pushPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY || null;
}

function configured(): boolean {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
}

let vapidSet = false;
function sender(): Sender | null {
  if (customSender) return customSender;
  if (!configured()) return null;
  if (!vapidSet) {
    setVapidDetails(process.env.VAPID_SUBJECT!, process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
    vapidSet = true;
  }
  return (sub, payload) => sendNotification(sub, payload, { TTL: 60 * 60, urgency: "high" });
}

// --- subscriptions ---------------------------------------------------------------

function checkEndpoint(endpoint: string) {
  // Push services are always HTTPS; anything else is refused so the server is never pointed at an arbitrary address.
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new DomainError("That alert subscription is not valid.");
  }
  if (url.protocol !== "https:" || endpoint.length > 1000) throw new DomainError("That alert subscription is not valid.");
}

export async function savePushSubscription(ctx: TenantContext, input: { endpoint: string; p256dh: string; auth: string }) {
  checkEndpoint(input.endpoint);
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(input.p256dh) || !/^[A-Za-z0-9_-]{8,100}$/.test(input.auth)) {
    throw new DomainError("That alert subscription is not valid.");
  }
  // One browser, one subscription: if someone else signed in on this browser before, it now belongs to this person.
  await db.pushSubscription.upsert({
    where: { endpoint: input.endpoint },
    create: { userId: ctx.userId, businessId: ctx.businessId, ...input },
    update: { userId: ctx.userId, businessId: ctx.businessId, p256dh: input.p256dh, auth: input.auth },
  });
}

export async function removePushSubscription(ctx: TenantContext, endpoint: string) {
  await db.pushSubscription.deleteMany({ where: { endpoint, userId: ctx.userId } });
}

// --- sending ---------------------------------------------------------------------

async function deliver(subs: { id: string; endpoint: string; p256dh: string; auth: string }[], payload: PushPayload) {
  const send = sender();
  if (!send || subs.length === 0) return 0;
  const body = JSON.stringify(payload);
  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body);
        sent += 1;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        // 404 / 410: the browser unsubscribed or was uninstalled. Forget it.
        if (status === 404 || status === 410) await db.pushSubscription.deleteMany({ where: { id: s.id } }).catch(() => {});
      }
    }),
  );
  return sent;
}

/**
 * Tell the team members who can act on something. `permission` picks the roles; with a branch, only people who work in
 * that branch. Never throws: a failed push must not undo the order that triggered it.
 */
export async function pushToTeam(input: { businessId: string; branchId?: string; permission: Permission; payload: PushPayload }) {
  try {
    if (!customSender && !configured()) return 0;
    const members = await db.membership.findMany({
      where: {
        businessId: input.businessId,
        ...(input.branchId ? { OR: [{ allBranches: true }, { branches: { some: { branchId: input.branchId } } }] } : {}),
      },
      select: { userId: true, role: true, customRole: { select: { permissions: true } } },
    });
    const userIds = members.filter((m) => (m.customRole ? m.customRole.permissions.includes(input.permission) : can(m.role, input.permission))).map((m) => m.userId);
    if (userIds.length === 0) return 0;
    const subs = await db.pushSubscription.findMany({ where: { businessId: input.businessId, userId: { in: userIds } } });
    return await deliver(subs, input.payload);
  } catch {
    return 0;
  }
}

/** Tell one person (for example the rider a delivery was just given to). */
export async function pushToUser(input: { businessId: string; userId: string; payload: PushPayload }) {
  try {
    if (!customSender && !configured()) return 0;
    const subs = await db.pushSubscription.findMany({ where: { businessId: input.businessId, userId: input.userId } });
    return await deliver(subs, input.payload);
  } catch {
    return 0;
  }
}
