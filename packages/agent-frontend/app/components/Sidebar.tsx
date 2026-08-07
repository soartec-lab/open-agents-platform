/**
 * Sidebar — the Discord-like left rail shared by every route (rendered by
 * root.tsx): the channel list with a create button, and the Agents nav item.
 * Channels ride the shared SWR cache (key = the endpoint URL), so the channel
 * room and any dialog mutating the list update the rail for free.
 */

import { BotIcon, HashIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { NavLink, useNavigate } from "react-router";
import { useGetChannels } from "../api/channels/channels.ts";
import { bearer } from "../lib/bearer.ts";
import { CreateChannelDialog } from "../routes/channels/CreateChannelDialog.tsx";
import { Button } from "./ui/button.tsx";
import { ScrollArea } from "./ui/scroll-area.tsx";

export function Sidebar({ token }: { token: string }) {
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const { data: channelsRes } = useGetChannels({ fetch: { headers: bearer(token) } });
  const channels = channelsRes?.status === 200 ? channelsRes.data.channels : [];

  const itemClass = "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm";
  const idleClass = `${itemClass} text-muted-foreground hover:bg-muted hover:text-foreground`;
  const activeClass = `${itemClass} bg-muted font-medium text-foreground`;

  return (
    <nav className="flex h-full w-60 shrink-0 flex-col border-r bg-muted/30">
      <div className="border-b px-4 py-3">
        <span className="font-semibold text-sm">Open Agents Platform</span>
      </div>

      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
          Channels
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          type="button"
          title="New channel"
          onClick={() => setCreateOpen(true)}
        >
          <PlusIcon className="size-4" />
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1 px-2">
        <div className="flex flex-col gap-0.5 pb-2">
          {channels.length === 0 && (
            <p className="px-2 py-1.5 text-muted-foreground text-xs">
              No channels yet — create one to start working with your agents.
            </p>
          )}
          {channels.map((channel) => (
            <NavLink
              key={channel.id}
              to={`/channels/${channel.id}`}
              className={({ isActive }) => (isActive ? activeClass : idleClass)}
            >
              <HashIcon className="size-4 shrink-0" />
              <span className="truncate">{channel.name}</span>
              <span className="ml-auto shrink-0 text-muted-foreground text-xs">
                {channel.members.length || ""}
              </span>
            </NavLink>
          ))}
        </div>
      </ScrollArea>

      <div className="border-t p-2">
        <NavLink to="/agents" className={({ isActive }) => (isActive ? activeClass : idleClass)}>
          <BotIcon className="size-4" />
          Agents
        </NavLink>
      </div>

      <CreateChannelDialog
        open={createOpen}
        token={token}
        onClose={() => setCreateOpen(false)}
        onCreated={(channelId) => {
          setCreateOpen(false);
          void navigate(`/channels/${channelId}`);
        }}
      />
    </nav>
  );
}
