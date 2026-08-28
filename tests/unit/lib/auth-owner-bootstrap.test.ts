import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { bootstrapConfiguredOwnerInTx, getConfiguredOwnerEmail } from "@/lib/auth/owner-bootstrap";

type BootstrapUser = Parameters<typeof bootstrapConfiguredOwnerInTx>[1];

const user = {
  id: "user-1",
  email: "owner@example.com",
  role: "user",
  adminSeasonIds: [],
} as unknown as BootstrapUser;

function createTx(existingSuperAdmins: unknown[] = [], promotedUser: unknown = { ...user, role: "super_admin" }) {
  const executeMock = vi.fn().mockResolvedValue(undefined);
  const selectMock = vi.fn();
  const updateMock = vi.fn();
  const insertMock = vi.fn();
  const forMock = vi.fn().mockResolvedValue(existingSuperAdmins);
  const whereSelectMock = vi.fn(() => ({ for: forMock }));
  const fromMock = vi.fn(() => ({ where: whereSelectMock }));
  selectMock.mockReturnValue({ from: fromMock });
  const returningMock = vi.fn().mockResolvedValue(promotedUser ? [promotedUser] : []);
  const whereUpdateMock = vi.fn(() => ({ returning: returningMock }));
  const setMock = vi.fn(() => ({ where: whereUpdateMock }));
  updateMock.mockReturnValue({ set: setMock });
  const valuesMock = vi.fn().mockResolvedValue(undefined);
  insertMock.mockReturnValue({ values: valuesMock });

  return {
    tx: { execute: executeMock, select: selectMock, update: updateMock, insert: insertMock },
    executeMock,
    selectMock,
    setMock,
    valuesMock,
  };
}

describe("configured owner bootstrap", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    delete process.env.RIVALHUB_OWNER_EMAIL;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.RIVALHUB_OWNER_EMAIL;
  });

  it("does nothing when the owner email is not configured", async () => {
    const { tx, executeMock, selectMock, setMock, valuesMock } = createTx();

    await expect(bootstrapConfiguredOwnerInTx(tx as never, user)).resolves.toBe(user);

    expect(getConfiguredOwnerEmail()).toBeNull();
    expect(executeMock).not.toHaveBeenCalled();
    expect(selectMock).not.toHaveBeenCalled();
    expect(setMock).not.toHaveBeenCalled();
    expect(valuesMock).not.toHaveBeenCalled();
  });

  it("promotes only the normalized configured owner while no super_admin exists", async () => {
    vi.stubEnv("RIVALHUB_OWNER_EMAIL", " OWNER@EXAMPLE.COM ");
    const { tx, executeMock, setMock, valuesMock } = createTx();

    const result = await bootstrapConfiguredOwnerInTx(tx as never, user);

    expect(result).toMatchObject({ id: "user-1", role: "super_admin" });
    expect(executeMock).toHaveBeenCalledOnce();
    expect(setMock).toHaveBeenCalledWith(expect.objectContaining({ role: "super_admin" }));
    expect(valuesMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "user.owner_bootstrap",
      targetId: "user-1",
      meta: expect.objectContaining({ email: "owner@example.com" }),
    }));
  });

  it("permanently stops the bootstrap path once any super_admin exists", async () => {
    vi.stubEnv("RIVALHUB_OWNER_EMAIL", "owner@example.com");
    const { tx, executeMock, setMock, valuesMock } = createTx([{ id: "existing-admin" }]);

    await expect(bootstrapConfiguredOwnerInTx(tx as never, user)).resolves.toBe(user);

    expect(executeMock).toHaveBeenCalledOnce();
    expect(setMock).not.toHaveBeenCalled();
    expect(valuesMock).not.toHaveBeenCalled();
  });

  it("does not bootstrap an account whose normalized email is different", async () => {
    vi.stubEnv("RIVALHUB_OWNER_EMAIL", "owner@example.com");
    const { tx, executeMock, setMock, valuesMock } = createTx();
    const otherUser = { ...user, email: "other@example.com" };

    await expect(bootstrapConfiguredOwnerInTx(tx as never, otherUser)).resolves.toBe(otherUser);

    expect(executeMock).not.toHaveBeenCalled();
    expect(setMock).not.toHaveBeenCalled();
    expect(valuesMock).not.toHaveBeenCalled();
  });
});
