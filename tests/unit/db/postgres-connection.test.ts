import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect, createServer, type Server } from "node:tls";
import { Pool } from "pg";
import { postgresConnection } from "../../../src/db/postgres-connection";
import { verifiedDumpScript } from "../../../scripts/db/recovery/verified-dump";

const host = "aws-0-ap-northeast-1.pooler.supabase.com";
const remote = `postgresql://postgres.test:password@${host}:6543/postgres?pgbouncer=true`;

describe("canonical PostgreSQL TLS", () => {
  it("pins CA and hostname for both pooler ports; URL parsing cannot override SSL", () => {
    for (const port of [5432, 6543]) {
      const config = postgresConnection(remote.replace(":6543", `:${port}`) + "&sslmode=require");
      expect(config.connectionString).not.toContain("sslmode");
      expect(config.ssl).toMatchObject({ rejectUnauthorized: true, servername: host, minVersion: "TLSv1.2" });
      const pool = new Pool(config);
      expect(pool.options.ssl).toEqual(config.ssl);
      void pool.end();
    }
  });
  it("rejects insecure/override URLs, missing trust and unapproved remote hosts", () => {
    for (const query of ["sslmode=disable", "sslmode=no-verify", "sslmode=prefer", "ssl=false", "sslrootcert=/tmp/x", "uselibpqcompat=true", "sslnegotiation=direct"]) {
      expect(() => postgresConnection(`${remote}&${query}`)).toThrow();
    }
    expect(() => postgresConnection(remote, " ")).toThrow(/CA/);
    expect(() => postgresConnection(remote.replace(host, "other.example"))).toThrow(/endpoint/);
    expect(() => postgresConnection("https://localhost")).toThrow(/protocol/);
  });
  it("keeps loopback plaintext development isolated", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
      expect(postgresConnection(`postgresql://local:local@${host}:5432/postgres?sslmode=disable`).ssl).toBe(false);
    }
  });
  it("makes CLI-generated dumps use explicit libpq verify-full with the same CA", () => {
    const template = '#!/usr/bin/env bash\nset -euo pipefail\nexport PGHOST="host"\npg_dump --schema-only';
    const script = verifiedDumpScript(template, remote);
    expect(script).toContain("export PGSSLMODE=verify-full");
    expect(script).toContain("export PGSSLROOTCERT=/tmp/rivalhub-root.crt");
    expect(script).toContain("BEGIN CERTIFICATE");
    expect(script).toContain('pg_dump --schema-only');
    expect(() => verifiedDumpScript("unknown", remote)).toThrow(/Unknown/);
    expect(() => verifiedDumpScript(template, "postgresql://localhost/postgres")).toThrow(/remote/);
  });
});

describe("real TLS trust and hostname rejection", () => {
  let root: string, ca: string, server: Server, port: number;
  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "rivalhub-tls-test-"));
    const run = (args: string[]) => execFileSync("openssl", args, { cwd: root, stdio: "ignore" });
    run(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "key.pem", "-out", "cert.pem", "-days", "1", "-subj", `/CN=${host}`, "-addext", `subjectAltName=DNS:${host}`]);
    ca = readFileSync(join(root, "cert.pem"), "utf8");
    server = createServer({ key: readFileSync(join(root, "key.pem")), cert: ca }, (socket) => socket.end());
    server.on("tlsClientError", () => {});
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as { port: number }).port;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  });
  function handshake(ca?: string, servername = host) {
    const ssl = postgresConnection(remote, ca).ssl;
    if (!ssl) throw new Error("remote TLS required");
    return new Promise<void>((resolve, reject) => {
      const socket = connect({ ...ssl, host: "127.0.0.1", port, servername }, () => { socket.end(); resolve(); });
      socket.on("error", reject);
    });
  }
  it("accepts a trusted matching identity", async () => { await handshake(ca); });
  it("rejects the wrong trust root", async () => { await expect(handshake()).rejects.toThrow(); });
  it("rejects a trusted certificate with the wrong hostname", async () => { await expect(handshake(ca, "wrong.example")).rejects.toThrow(/Hostname|Altname|altnames/i); });
});
