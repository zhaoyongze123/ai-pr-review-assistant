import "dotenv/config";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";

async function bootstrap() {
  try {
    const app = await NestFactory.create(AppModule, {
      logger: false,
      abortOnError: false,
    });
    app.setGlobalPrefix("api");
    app.enableShutdownHooks();
    const port = Number(process.env.PORT ?? 3001);
    await app.listen(port);
    console.log(`api listening on ${port}`);
  } catch (error) {
    console.error("api bootstrap failed", error);
    process.exit(1);
  }
}

void bootstrap();
