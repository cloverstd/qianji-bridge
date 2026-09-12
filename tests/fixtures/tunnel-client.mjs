// Local test process only. Never included in the application image or production startup.
import http from "node:http";
if (process.env.CONTROL_PLANE_API_KEY?.startsWith("EXIT_")) process.exit(1);
http
  .createServer((req, res) => {
    if (req.url === "/metrics") {
      res.writeHead(200);
      const key = process.env.CONTROL_PLANE_API_KEY;
      const stamp = key.startsWith("NO_POLL_")
        ? 0
        : Math.floor(Date.now() / 1000) - (key.startsWith("STALE_") ? 120 : 0);
      res.end(
        'commands_poll_last_successful_timestamp_seconds{otel_scope_name="poller"} ' +
          stamp +
          "\n",
      );
      return;
    }
    const ready = !process.env.CONTROL_PLANE_API_KEY?.startsWith("NOT_READY_");
    res.writeHead(req.url === "/readyz" && ready ? 200 : 503);
    // Deliberately sensitive upstream body must never appear in API status.
    res.end(process.env.CONTROL_PLANE_API_KEY);
  })
  .listen(
    Number(process.env.HEALTH_LISTEN_ADDR.split(":").at(-1)),
    "127.0.0.1",
  );
