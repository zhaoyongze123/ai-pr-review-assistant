import "dotenv/config";
import { createRepositoryScanWorker } from "./repository-scan-worker.js";

async function bootstrap() {
  const runtime = createRepositoryScanWorker();

  const close = async () => {
    await runtime.close();
  };

  process.once("SIGINT", () => {
    void close().finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void close().finally(() => process.exit(0));
  });

  console.log("worker repository scan queue ready");
}

void bootstrap().catch((error) => {
  console.error("worker bootstrap failed", error);
  process.exit(1);
});
