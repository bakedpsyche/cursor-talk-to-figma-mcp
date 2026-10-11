#!/usr/bin/env bun
// Send one command to the Figma plugin through the local relay, without the MCP server.
//
//   bun scripts/figma.ts <command> ['<json params>']
//   bun scripts/figma.ts get_variables '{"collection":"Website (DesignPrem)"}'
//
// Needs the relay running (`bun socket`) and the plugin open in Figma. The fork's
// plugin always joins channel "prem"; set FIGMA_CHANNEL to use another one.
// Prints the plugin's result as JSON; exits 1 on an error or timeout.

const [command, rawParams = "{}"] = process.argv.slice(2);
if (!command) {
  console.error("usage: bun scripts/figma.ts <command> ['<json params>']");
  process.exit(2);
}
const channel = process.env.FIGMA_CHANNEL ?? "prem";

const params = JSON.parse(rawParams);
const port = process.env.FIGMA_RELAY_PORT ?? "3055";
const timeoutMs = Number(process.env.FIGMA_TIMEOUT_MS ?? 30000);
const id = crypto.randomUUID();
const ws = new WebSocket(`ws://127.0.0.1:${port}`);

const timer = setTimeout(() => {
  console.error(`Timed out after ${timeoutMs / 1000}s (is the plugin open on channel ${channel}?)`);
  process.exit(1);
}, timeoutMs);

ws.onopen = () => {
  ws.send(JSON.stringify({ id: crypto.randomUUID(), type: "join", channel }));
};

ws.onmessage = (event) => {
  const data = JSON.parse(String(event.data));

  // The relay confirms the join; then send the command
  if (data.type === "system" && data.message === `Joined channel: ${channel}`) {
    ws.send(
      JSON.stringify({
        id,
        type: "message",
        channel,
        message: { id, command, params: { ...params, commandId: id } },
      })
    );
    return;
  }

  const reply = data.message;
  if (data.type !== "broadcast" || !reply || reply.id !== id || reply.command) return;

  clearTimeout(timer);
  ws.close();
  if (reply.error) {
    console.error(reply.error);
    process.exit(1);
  }
  console.log(JSON.stringify(reply.result, null, 2));
  process.exit(0);
};

ws.onerror = () => {
  console.error(`Cannot reach the relay on ws://127.0.0.1:${port} (run \`bun socket\`)`);
  process.exit(1);
};
