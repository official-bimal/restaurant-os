import type { Metadata } from "next";
import { DisplayScreen } from "./display-screen";

export const metadata: Metadata = { title: "Customer screen", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** The customer-facing screen. The secret in the link is the only credential; there is no login and no menu. */
export default async function DisplayPage({ params, searchParams }: PageProps<"/display/[token]">) {
  const { token } = await params;
  const sp = await searchParams;
  return <DisplayScreen token={token} embedded={sp.embedded === "1"} />;
}
