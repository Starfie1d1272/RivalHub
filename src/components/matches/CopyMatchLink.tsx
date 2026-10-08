"use client";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function CopyMatchLink({ href }: { href: string }) {
  return <Button type="button" variant="outline" size="sm" onClick={async () => {
    try {
      await navigator.clipboard.writeText(new URL(href, window.location.origin).href);
      toast.success("比赛链接已复制，打开即可观看");
    } catch {
      toast.error("复制失败，请打开比赛页面复制地址");
    }
  }}>复制观看链接</Button>;
}
