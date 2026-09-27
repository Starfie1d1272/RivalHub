"use client";
import { useEffect, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
export function usePredictionConfirmation() {
  const [message, setMessage] = useState<string | null>(null);
  const resolver = useRef<((answer: boolean) => void) | null>(null);
  useEffect(
    () => () => {
      resolver.current?.(false);
    },
    [],
  );
  function resolve(answer: boolean) {
    resolver.current?.(answer);
    resolver.current = null;
    setMessage(null);
  }
  function confirm(text: string) {
    resolver.current?.(false);
    setMessage(text);
    return new Promise<boolean>((accept) => {
      resolver.current = accept;
    });
  }
  const confirmation = (
    <AlertDialog
      open={message !== null}
      onOpenChange={(open) => {
        if (!open) resolve(false);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确认操作</AlertDialogTitle>
          <AlertDialogDescription>{message}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => resolve(false)}>
            取消
          </AlertDialogCancel>
          <AlertDialogAction onClick={() => resolve(true)}>
            确认继续
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  return { confirm, confirmation };
}
