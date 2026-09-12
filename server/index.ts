import { createApp } from "./app.js";
import { createMcpApp } from "./mcp.js";
const { app, store, service } = await createApp();
const mcp =
  process.env.ENABLE_MCP === "true"
    ? await createMcpApp(store, service)
    : undefined;
if (mcp) {
  await mcp.listen({
    host: "127.0.0.1",
    port: Number(process.env.MCP_PORT ?? 3002),
  });
  console.log("钱迹 MCP：仅监听容器回环地址，无鉴权");
}
await app.listen({
  host: process.env.HOST ?? "0.0.0.0",
  port: Number(process.env.PORT ?? 3001),
});
console.log(`钱迹网页版：http://localhost:${process.env.PORT ?? 3001}`);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await mcp?.close();
    await app.close();
    process.exit(0);
  });
