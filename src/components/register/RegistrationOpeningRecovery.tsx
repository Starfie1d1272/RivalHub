"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { recoverRegistrationOpening } from "@/actions/registration-opening";

export function RegistrationOpeningRecovery({ seasonId }: { seasonId: string }) {
  const router = useRouter();
  const attempted = useRef(false);
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;
    startTransition(async () => {
      const result = await recoverRegistrationOpening({ seasonId });
      if (result.success) {
        router.refresh();
      } else if (!result.success) {
        toast.error(result.error.message);
      }
    });
  }, [router, seasonId]);

  return <p className="mt-3 text-center text-xs text-[var(--color-fg-mid)]">页面会自动确认开放状态。</p>;
}
