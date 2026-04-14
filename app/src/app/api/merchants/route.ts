import "server-only";
import { NextResponse } from "next/server";
import { fixtureAdapter, FIXTURE_MERCHANT_IDS } from "@/lib/server/revenue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/merchants — list the revenue profiles currently known to the
 * connected revenue adapter (Fixture today; Shopify/Stripe post-hackathon).
 *
 * Returning full profiles here (rather than just IDs) lets the UI render the
 * 90-day revenue chart without a second round-trip.
 */
export async function GET() {
  const profiles = await Promise.all(
    FIXTURE_MERCHANT_IDS.map((id) => fixtureAdapter.fetchProfile(id)),
  );
  return NextResponse.json({
    adapter: fixtureAdapter.name,
    merchants: profiles,
  });
}
