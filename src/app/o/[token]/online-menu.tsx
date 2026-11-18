"use client";

import { GuestMenu, type MenuCategory } from "@/app/t/[token]/guest-menu";
import { OnlineCheckout, type CheckoutBranch } from "./online-checkout";

/**
 * The menu with its checkout. A function cannot be handed from a server page to a client component, so the pairing is made here, on
 * the client side.
 */
export function OnlineMenu({ token, categories, branch }: { token: string; categories: MenuCategory[]; branch: CheckoutBranch }) {
  return <GuestMenu token={token} categories={categories} checkout={(api) => <OnlineCheckout token={token} api={api} branch={branch} />} />;
}
