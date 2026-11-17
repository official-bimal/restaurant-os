import { redirect } from "next/navigation";
import { DomainError } from "@/server/errors";

/** Run a service call; on a business-rule error, go back to the page with a message. */
export async function guarded<T>(backTo: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof DomainError) {
      redirect(`${backTo}${backTo.includes("?") ? "&" : "?"}error=${encodeURIComponent(e.message)}`);
    }
    throw e;
  }
}
