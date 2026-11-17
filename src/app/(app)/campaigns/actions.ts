"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/server/auth";
import { guarded } from "@/server/guarded";
import { saveRule } from "@/features/campaigns/server/automation";
import { sendCampaign } from "@/features/messaging/server/send";
import { createCampaign, markSent, prepareCampaign, recordOptOut } from "@/features/campaigns/server/service";

export async function createCampaignAction(formData: FormData) {
  const ctx = await requireTenant("campaign.manage");
  const input = z
    .object({
      name: z.string().max(200),
      segment: z.string().max(30),
      template: z.string().max(1000),
    })
    .parse({
      name: formData.get("name") ?? "",
      segment: formData.get("segment") ?? "",
      template: formData.get("template") ?? "",
    });
  const campaign = await guarded("/campaigns", () =>
    createCampaign(ctx, {
      ...input,
      offerPoints: Math.trunc(Number(formData.get("offerPoints") || 0)),
      offerDays: Math.trunc(Number(formData.get("offerDays") || 14)),
    }),
  );
  revalidatePath("/campaigns");
  redirect(`/campaigns/${campaign.id}`);
}

export async function prepareCampaignAction(id: string) {
  const ctx = await requireTenant("campaign.manage");
  const res = await guarded(`/campaigns/${id}`, () => prepareCampaign(ctx, id));
  revalidatePath(`/campaigns/${id}`);
  const note = `Prepared ${res.prepared} message${res.prepared === 1 ? "" : "s"}. Left out: ${res.noConsent} without confirmed consent, ${res.tooSoon} messaged this week.`;
  redirect(`/campaigns/${id}?note=${encodeURIComponent(note)}`);
}

export async function markSentAction(campaignId: string, messageId: string) {
  const ctx = await requireTenant("campaign.manage");
  await guarded(`/campaigns/${campaignId}`, () => markSent(ctx, messageId));
  revalidatePath(`/campaigns/${campaignId}`);
  redirect(`/campaigns/${campaignId}`);
}

/** Sends the ready messages through the configured provider. Only runs from the confirm button, with the count the person saw. */
export async function sendCampaignAction(campaignId: string, formData: FormData) {
  const ctx = await requireTenant("message.send");
  const expected = Number(formData.get("expected"));
  const res = await guarded(`/campaigns/${campaignId}`, () => sendCampaign(ctx, campaignId, expected));
  revalidatePath(`/campaigns/${campaignId}`);
  const parts = [`Sent ${res.sent}`];
  if (res.failed) parts.push(`${res.failed} failed${res.firstError ? ` (${res.firstError})` : ""}`);
  if (res.skipped) parts.push(`${res.skipped} left out (no consent or no number)`);
  if (res.deferred) parts.push(`${res.deferred} left for tomorrow (daily limit)`);
  redirect(`/campaigns/${campaignId}?note=${encodeURIComponent(parts.join(". ") + ".")}`);
}

export async function optOutAction(campaignId: string, messageId: string) {
  const ctx = await requireTenant("campaign.manage");
  await guarded(`/campaigns/${campaignId}`, () => recordOptOut(ctx, messageId));
  revalidatePath(`/campaigns/${campaignId}`);
  redirect(`/campaigns/${campaignId}`);
}

/** Save one automatic rule (birthday or win-back). */
export async function saveRuleAction(kind: string, formData: FormData) {
  const ctx = await requireTenant("campaign.manage");
  const back = "/campaigns/automatic";
  const input = {
    enabled: formData.get("enabled") === "on",
    autoSend: formData.get("mode") === "send",
    template: z.string().max(1000).parse(formData.get("template") ?? ""),
    offerPoints: Math.trunc(Number(formData.get("offerPoints") || 0)),
    offerDays: Math.trunc(Number(formData.get("offerDays") || 14)),
    cooldownDays: Math.trunc(Number(formData.get("cooldownDays") || 60)),
  };
  await guarded(back, () => saveRule(ctx, kind, input));
  revalidatePath(back);
  redirect(`${back}?note=${encodeURIComponent("Saved.")}`);
}
