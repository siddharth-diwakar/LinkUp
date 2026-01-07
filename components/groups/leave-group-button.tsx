"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

type Props = {
  groupId: string;
};

export function LeaveGroupButton({ groupId }: Props) {
  const router = useRouter();
  const [isLeaving, setIsLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onLeave = async () => {
    setIsLeaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/groups/${groupId}/leave`, {
        method: "POST",
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setError(payload?.error ?? "Unable to leave group.");
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsLeaving(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onLeave}
        disabled={isLeaving}
        className="border-foreground/20 bg-background/60"
      >
        {isLeaving ? "Leaving..." : "Leave group"}
      </Button>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  );
}
