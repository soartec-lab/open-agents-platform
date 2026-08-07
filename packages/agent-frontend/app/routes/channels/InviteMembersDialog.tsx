/**
 * InviteMembersDialog — check agents that are not members yet and invite
 * them. The parent refreshes the shared channels SWR key afterwards.
 */

import { useState } from "react";
import { useGetAgentConfigs } from "../../api/agent-configs/agent-configs.ts";
import { createChannelMember } from "../../api/channels/channels.ts";
import type { Channel } from "../../api/schemas";
import { Button } from "../../components/ui/button.tsx";
import { Checkbox } from "../../components/ui/checkbox.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/dialog.tsx";
import { bearer } from "../../lib/bearer.ts";

export function InviteMembersDialog({
  open,
  channel,
  token,
  onClose,
  onChanged,
}: {
  open: boolean;
  channel: Channel;
  token: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: configsRes } = useGetAgentConfigs({
    swr: { enabled: open },
    fetch: { headers: bearer(token) },
  });
  const memberIds = new Set(channel.members.map((m) => m.configId));
  const candidates = (configsRes?.status === 200 ? configsRes.data.configs : []).filter(
    (config) => !memberIds.has(config.id),
  );

  const toggle = (configId: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(configId)) {
        next.delete(configId);
      } else {
        next.add(configId);
      }
      return next;
    });

  const close = () => {
    setChecked(new Set());
    setError(null);
    onClose();
  };

  const handleInvite = async () => {
    if (inviting || checked.size === 0) return;
    setInviting(true);
    setError(null);
    try {
      for (const configId of checked) {
        const res = await createChannelMember(channel.id, { configId }, { headers: bearer(token) });
        if (res.status !== 201 && res.status !== 409) {
          throw new Error(`Invite failed (HTTP ${res.status}).`);
        }
      }
      onChanged();
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invite failed.");
    } finally {
      setInviting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) close();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Invite agents to #{channel.name}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <span className="font-medium text-sm">Agents</span>
          {candidates.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Every agent is already a member — create more on the Agents page.
            </p>
          ) : (
            <div className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-md border p-2">
              {candidates.map((config) => (
                <label
                  key={config.id}
                  htmlFor={`invite-${config.id}`}
                  className="flex items-center gap-2 text-sm"
                >
                  <Checkbox
                    id={`invite-${config.id}`}
                    checked={checked.has(config.id)}
                    onCheckedChange={() => toggle(config.id)}
                  />
                  <span className="truncate">{config.name}</span>
                  {config.role && (
                    <span className="truncate text-muted-foreground text-xs">{config.role}</span>
                  )}
                </label>
              ))}
            </div>
          )}
          {error && <p className="text-destructive text-sm">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" type="button" onClick={close}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={inviting || checked.size === 0}
              onClick={() => void handleInvite()}
            >
              Invite
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
