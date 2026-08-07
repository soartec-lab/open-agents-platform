import { index, type RouteConfig, route } from "@react-router/dev/routes";

// One Discord-like screen: the sidebar (channels + agents nav) lives in
// root.tsx, so all three routes share it. Explicitly defined — fs-routes is
// not used.
export default [
  index("./routes/home/route.tsx"),
  route("channels/:channelId", "./routes/channels/route.tsx"),
  route("agents", "./routes/agents/route.tsx"),
] satisfies RouteConfig;
