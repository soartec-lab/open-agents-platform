/**
 * CreateChannelDialog — name + optional goal + an agent checklist. Creates
 * the channel, invites the checked agents, refreshes the shared channels SWR
 * key, and hands the new id to the caller (the sidebar navigates to it).
 */

import { useState } from "react";
import { mutate } from "swr";
import { useGetAgentConfigs } from "../../api/agent-configs/agent-configs.ts";
import {
  createChannelMember,
  getGetChannelsKey,
  useCreateChannel,
} from "../../api/channels/channels.ts";
import { Button } from "../../components/ui/button.tsx";
import { Checkbox } from "../../components/ui/checkbox.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/dialog.tsx";
import { Input } from "../../components/ui/input.tsx";
import { Label } from "../../components/ui/label.tsx";
import { Textarea } from "../../components/ui/textarea.tsx";
import { bearer } from "../../lib/bearer.ts";

const NAME_MAX = 100;
const GOAL_MAX = 2000;

export function CreateChannelDialog({
  open,
  token,
  onClose,
  onCreated,
}: {
  open: boolean;
  token: string;
  onClose: () => void;
  onCreated: (channelId: string) => void;
}) {
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const { data: configsRes } = useGetAgentConfigs({
    swr: { enabled: open },
    fetch: { headers: bearer(token) },
  });
  const configs = configsRes?.status === 200 ? configsRes.data.configs : [];

  const { trigger: create, isMutating } = useCreateChannel({
    fetch: { headers: bearer(token) },
  });

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

  const reset = () => {
    setName("");
    setGoal("");
    setChecked(new Set());
    setError(null);
  };

  const handleCreate = async () => {
    if (isMutating || !name.trim()) return;
    setError(null);
    try {
      const res = await create({
        name: name.trim(),
        ...(goal.trim() && { goal: goal.trim() }),
      });
      if (res.status !== 201) {
        setError(`Create failed (HTTP ${res.status}).`);
        return;
      }
      const channelId = res.data.id;
      for (const configId of checked) {
        await createChannelMember(channelId, { configId }, { headers: bearer(token) });
      }
      await mutate(getGetChannelsKey());
      reset();
      onCreated(channelId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed.");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New channel</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="channel-name">Name</Label>
            <Input
              id="channel-name"
              value={name}
              maxLength={NAME_MAX}
              placeholder="launch-plan"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="channel-goal">Goal (optional)</Label>
            <Textarea
              id="channel-goal"
              value={goal}
              maxLength={GOAL_MAX}
              rows={3}
              placeholder="What this channel is working toward — every agent sees it."
              onChange={(e) => setGoal(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="font-medium text-sm">Invite agents</span>
            {configs.length === 0 ? (
              <p className="text-muted-foreground text-xs">
                No agents yet — create them on the Agents page. You can also invite later.
              </p>
            ) : (
              <div className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-md border p-2">
                {configs.map((config) => (
                  <label
                    key={config.id}
                    htmlFor={`pick-${config.id}`}
                    className="flex items-center gap-2 text-sm"
                  >
                    <Checkbox
                      id={`pick-${config.id}`}
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
            <p className="text-muted-foreground text-xs">
              One agent = a 1:1 chat. Several = the orchestrator coordinates them.
            </p>
          </div>
          {error && <p className="text-destructive text-sm">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={isMutating || !name.trim()}
              onClick={() => void handleCreate()}
            >
              Create channel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
