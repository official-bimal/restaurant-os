"use client";

import { LocationSharer } from "@/components/location-sharer";

/** Binds one delivery to the sharer, so the server action only ever receives coordinates. */
export function ShareLocation({
  orderId,
  send,
}: {
  orderId: string;
  send: (orderId: string, lat: number, lng: number) => Promise<{ ok: boolean; error?: string }>;
}) {
  return <LocationSharer send={(lat, lng) => send(orderId, lat, lng)} />;
}
