/**
 * `/agents` — the agent management screen: the user-created agent catalog
 * (name + optional role + instructions) with create / edit / delete. Agents
 * created here are what channels invite; edits apply to live conversations on
 * their next message (the backend re-reads the config per delivered message).
 */

import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { mutate } from "swr";
import {
  getGetAgentConfigsKey,
  useCreateAgentConfig,
  useDeleteAgentConfig,
  useGetAgentConfigs,
  useUpdateAgentConfig,
} from "../../api/agent-configs/agent-configs.ts";
import { getGetChannelsKey } from "../../api/channels/channels.ts";
import type { AgentConfig } from "../../api/schemas";
import { Button } from "../../components/ui/button.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/dialog.tsx";
import { Input } from "../../components/ui/input.tsx";
import { Label } from "../../components/ui/label.tsx";
import { ScrollArea } from "../../components/ui/scroll-area.tsx";
import { Textarea } from "../../components/ui/textarea.tsx";
import { avatarColor, avatarInitials } from "../channels/members.ts";

const NAME_MAX = 100;
const ROLE_MAX = 100;
const INSTRUCTIONS_MAX = 4000;

/** Refresh everything an agent edit can touch (names are denormalized into channel members). */
const refreshCatalog = () => {
  void mutate(getGetAgentConfigsKey());
  void mutate(getGetChannelsKey());
};

export default function AgentsRoute() {
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<AgentConfig | null>(null);

  const { data: configsRes, isLoading } = useGetAgentConfigs();
  const configs = configsRes?.status === 200 ? configsRes.data.configs : [];

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b px-4 py-3">
        <h1 className="font-semibold text-base">Agents</h1>
        <span className="text-muted-foreground text-xs">
          Create the agents your channels invite.
        </span>
        <Button type="button" size="sm" className="ml-auto" onClick={() => setCreateOpen(true)}>
          <PlusIcon className="size-4" /> New agent
        </Button>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto flex max-w-2xl flex-col gap-3 p-4">
          {configs.length === 0 && (
            <p className="py-8 text-center text-muted-foreground text-sm">
              {isLoading
                ? "Loading…"
                : "No agents yet. Create one — a name, a role, and instructions are all it takes."}
            </p>
          )}
          {configs.map((config) => (
            <AgentRow key={config.id} config={config} onEdit={() => setEditing(config)} />
          ))}
        </div>
      </ScrollArea>

      <AgentFormDialog
        key={createOpen ? "create" : "create-closed"}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
      {editing && (
        <AgentFormDialog key={editing.id} open config={editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function AgentRow({ config, onEdit }: { config: AgentConfig; onEdit: () => void }) {
  const { trigger: remove, isMutating: deleting } = useDeleteAgentConfig(config.id);

  const handleDelete = async () => {
    if (deleting) return;
    await remove();
    refreshCatalog();
  };

  return (
    <div className="flex items-start gap-3 rounded-lg border p-3">
      <span
        className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full font-medium text-sm text-white ${avatarColor(config.name)}`}
      >
        {avatarInitials(config.name)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-semibold text-sm">{config.name}</span>
          {config.role && <span className="text-muted-foreground text-xs">{config.role}</span>}
        </div>
        <p className="line-clamp-2 text-muted-foreground text-sm">{config.instructions}</p>
      </div>
      <div className="flex shrink-0 gap-1">
        <Button variant="outline" size="xs" type="button" onClick={onEdit}>
          Edit
        </Button>
        <Button
          variant="ghost"
          size="xs"
          type="button"
          className="text-destructive"
          disabled={deleting}
          onClick={() => void handleDelete()}
        >
          Delete
        </Button>
      </div>
    </div>
  );
}

/** Create (no `config`) or edit (`config` set) an agent. */
function AgentFormDialog({
  open,
  config,
  onClose,
}: {
  open: boolean;
  config?: AgentConfig;
  onClose: () => void;
}) {
  const [name, setName] = useState(config?.name ?? "");
  const [role, setRole] = useState(config?.role ?? "");
  const [instructions, setInstructions] = useState(config?.instructions ?? "");
  const [error, setError] = useState<string | null>(null);

  const { trigger: create, isMutating: creating } = useCreateAgentConfig();
  const { trigger: update, isMutating: updating } = useUpdateAgentConfig(config?.id ?? "");
  const saving = creating || updating;

  const handleSave = async () => {
    if (saving || !name.trim() || !instructions.trim()) return;
    setError(null);
    const trimmedRole = role.trim();
    const res = config
      ? await update({
          name: name.trim(),
          instructions: instructions.trim(),
          // null clears the role; a non-empty string replaces it.
          role: trimmedRole === "" ? null : trimmedRole,
        })
      : await create({
          name: name.trim(),
          instructions: instructions.trim(),
          ...(trimmedRole && { role: trimmedRole }),
        });
    if (res.status === 409) {
      setError("That name is already taken — agent names must be unique.");
      return;
    }
    if (res.status !== 200 && res.status !== 201) {
      setError(`Save failed (HTTP ${res.status}).`);
      return;
    }
    refreshCatalog();
    onClose();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{config ? `Edit ${config.name}` : "New agent"}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="agent-name">Name</Label>
            <Input
              id="agent-name"
              value={name}
              maxLength={NAME_MAX}
              placeholder="Researcher"
              onChange={(e) => setName(e.target.value)}
            />
            <p className="text-muted-foreground text-xs">
              Unique — the orchestrator and @mentions address the agent by it.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="agent-role">Role (optional)</Label>
            <Input
              id="agent-role"
              value={role}
              maxLength={ROLE_MAX}
              placeholder="Research"
              onChange={(e) => setRole(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="agent-instructions">Instructions</Label>
            <Textarea
              id="agent-instructions"
              value={instructions}
              maxLength={INSTRUCTIONS_MAX}
              rows={6}
              placeholder="Who this agent is, what it is good at, and how it should answer."
              onChange={(e) => setInstructions(e.target.value)}
            />
          </div>
          {error && <p className="text-destructive text-sm">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={saving || !name.trim() || !instructions.trim()}
              onClick={() => void handleSave()}
            >
              {config ? "Save" : "Create agent"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
