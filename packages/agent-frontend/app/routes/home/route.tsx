/**
 * `/` — the empty state shown before a channel is selected. The sidebar
 * (channels + agents nav) is rendered by root.tsx.
 */

import { HashIcon } from "lucide-react";

export default function HomeRoute() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
      <HashIcon className="size-8" />
      <p className="font-medium text-sm">Select a channel — or create one</p>
      <p className="max-w-sm text-center text-xs">
        A channel is a goal plus one or more invited agents. Invite one agent for a 1:1 chat; invite
        several and the orchestrator coordinates them.
      </p>
    </div>
  );
}
