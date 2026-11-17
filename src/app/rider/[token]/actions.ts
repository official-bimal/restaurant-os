"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { DomainError } from "@/server/errors";
import { reportLocationByToken, riderUpdate } from "@/features/delivery/server/service";

/** The rider's buttons. The token in the link is the only credential, and only forward steps are accepted. */
export async function riderAction(token: string, formData: FormData) {
  const action = z.enum(["PICKED_UP", "DELIVERED", "FAILED"]).parse(formData.get("action"));
  let target = `/rider/${token}`;
  try {
    await riderUpdate(token, action);
  } catch (e) {
    if (!(e instanceof DomainError)) throw e;
    target = `/rider/${token}?error=${encodeURIComponent(e.message)}`;
  }
  revalidatePath(`/rider/${token}`);
  redirect(target);
}

export async function shareLocationByLinkAction(token: string, lat: number, lng: number): Promise<{ ok: boolean; error?: string }> {
  try {
    await reportLocationByToken(token, Number(lat), Number(lng));
    return { ok: true };
  } catch (e) {
    if (e instanceof DomainError) return { ok: false, error: e.message };
    throw e;
  }
}
