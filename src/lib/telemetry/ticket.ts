import type { Ticket } from "./protocol";
import { ROLES, UUID } from "./protocol";

const encoder = new TextEncoder();
function base64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
function decode(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), c => c.charCodeAt(0));
}
async function key(secret: string) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
export async function accountKey(userId: string, secret: string): Promise<string> {
  return base64(new Uint8Array(await crypto.subtle.sign("HMAC", await key(secret), encoder.encode(`rivalhub-product-account-v1:${userId}`))));
}
export async function signTicket(ticket: Ticket, secret: string): Promise<string> {
  const body = base64(encoder.encode(JSON.stringify(ticket)));
  const signature = await crypto.subtle.sign("HMAC", await key(secret), encoder.encode(body));
  return `${body}.${base64(new Uint8Array(signature))}`;
}
export async function verifyTicket(token: string, secret: string, now: number): Promise<Ticket | null> {
  try {
    if (token.length > 1600 || secret.length < 32) return null;
    const [body, signature, extra] = token.split(".");
    if (!body || !signature || extra || !await crypto.subtle.verify("HMAC", await key(secret), decode(signature), encoder.encode(body))) return null;
    const ticket = JSON.parse(new TextDecoder().decode(decode(body))) as Ticket;
    if (ticket.v !== 1 || !UUID.test(ticket.id) || !ROLES.includes(ticket.role) || !Number.isInteger(ticket.exp) || ticket.exp <= now || ticket.exp > now + 86400000) return null;
    if (ticket.account !== null && !/^[A-Za-z0-9_-]{43}$/.test(ticket.account)) return null;
    if (!/^[A-Za-z0-9._-]{1,80}$/.test(ticket.release) || !["preview", "production"].includes(ticket.environment)) return null;
    if (new URL(ticket.origin).origin !== ticket.origin) return null;
    return ticket;
  } catch { return null; }
}
