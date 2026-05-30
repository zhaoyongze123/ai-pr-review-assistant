import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

// workspace 脚本在 apps/api 下执行时，这里显式回到仓库根目录加载 .env。
const currentDir = path.dirname(fileURLToPath(import.meta.url));
config({
  path: path.resolve(currentDir, "../../../.env"),
  quiet: true,
});
