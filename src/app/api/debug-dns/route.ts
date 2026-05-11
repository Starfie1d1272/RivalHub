import { NextResponse } from "next/server";
import dns from "dns/promises";

export const dynamic = "force-dynamic";

export async function GET() {
  const hostname = "db.feontmsggbbligghjrhl.supabase.co";
  const results: Record<string, unknown> = { hostname };

  // 1. System resolver (dns.resolve4)
  try {
    results.systemIp4 = (await dns.resolve4(hostname)).join(", ");
  } catch (e) {
    results.systemIp4 = `FAIL: ${(e as Error).message}`;
  }

  // 2. dns.lookup (uses system resolver, different code path)
  try {
    const { address } = await dns.lookup(hostname, { family: 4 });
    results.lookupIp = address;
  } catch (e) {
    results.lookupIp = `FAIL: ${(e as Error).message}`;
  }

  // 3. Custom resolver with Google DNS
  try {
    const resolver = new dns.Resolver();
    resolver.setServers(["8.8.8.8"]);
    results.googleIp4 = (await resolver.resolve4(hostname)).join(", ");
  } catch (e) {
    results.googleIp4 = `FAIL: ${(e as Error).message}`;
  }

  // 4. Try resolving supabase.com to see if domain works at all
  try {
    results.supabaseCom = (await dns.resolve4("supabase.com")).join(", ");
  } catch (e) {
    results.supabaseCom = `FAIL: ${(e as Error).message}`;
  }

  // 5. Check if supabase.co zone delegates to this subdomain
  try {
    results.supaNs = (await dns.resolveNs("supabase.co")).join(", ");
  } catch (e) {
    results.supaNs = `FAIL: ${(e as Error).message}`;
  }
  try {
    results.supaSoa = JSON.stringify(await dns.resolveSoa("supabase.co"));
  } catch (e) {
    results.supaSoa = `FAIL: ${(e as Error).message}`;
  }

  // 6. DATABASE_URL availability
  try {
    const dbUrl = process.env.DATABASE_URL;
    if (dbUrl) {
      const url = new URL(dbUrl);
      results.dbHostname = url.hostname;
      results.dbPort = url.port;
    }
  } catch { results.dbHostname = "parse error"; }

  return NextResponse.json(results);
}
