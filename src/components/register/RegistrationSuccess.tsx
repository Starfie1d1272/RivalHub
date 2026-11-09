import { useEffect, useRef } from "react";
import Link from "next/link";
import type { Route } from "next";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface RegistrationSuccessProps {
  seasonName: string;
  statusHref: Route;
}

export function RegistrationSuccess({ seasonName, statusHref }: RegistrationSuccessProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <div className="flex flex-col items-center gap-4 py-10 text-center sm:py-16">
      <CheckCircle2 size={40} className="text-[var(--color-ok)]" aria-hidden="true" />
      <div role="status" className="space-y-2">
        <h2 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold">
          报名已提交
        </h2>
        <p className="text-sm text-[var(--color-fg-secondary)]">
          {seasonName}已收到你的报名。请等待审核，可随时查看本届报名进度。
        </p>
      </div>
      <Button asChild variant="outline">
        <Link href={statusHref}>查看报名进度</Link>
      </Button>
    </div>
  );
}
