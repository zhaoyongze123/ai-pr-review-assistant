import { Inject, Injectable } from "@nestjs/common";
import { Client, RunTree } from "langsmith";
import { withRunTree } from "langsmith/traceable";
import type { LangsmithTraceOptions } from "@ai-pr-review/llm-gateway";
import { ApiConfigService } from "../repositories/api-config.service.js";

@Injectable()
export class LangsmithTraceService {
  private client: Client | undefined;

  constructor(
    @Inject(ApiConfigService)
    private readonly configService: ApiConfigService,
  ) {}

  async startRun(input: {
    name: string;
    runType: "chain" | "llm" | "tool";
    inputs: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    tags?: string[];
    parentRun?: RunTree;
  }): Promise<RunTree | undefined> {
    if (!this.configService.langsmithTracing) {
      return undefined;
    }

    try {
      const run = input.parentRun
        ? input.parentRun.createChild({
            name: input.name,
            run_type: input.runType,
            inputs: input.inputs,
            metadata: {
              project: this.configService.langsmithProject,
              ...(input.metadata ?? {}),
            },
            tags: input.tags ?? [],
          })
        : new RunTree({
            name: input.name,
            run_type: input.runType,
            project_name: this.configService.langsmithProject,
            client: this.getClient(),
            tracingEnabled: true,
            inputs: input.inputs,
            metadata: {
              project: this.configService.langsmithProject,
              ...(input.metadata ?? {}),
            },
            tags: input.tags ?? [],
          });

      await run.postRun();
      return run;
    } catch {
      return undefined;
    }
  }

  async endRun(input: {
    run?: RunTree;
    outputs?: Record<string, unknown>;
    error?: string;
    metadata?: Record<string, unknown>;
  }) {
    if (!input.run) {
      return;
    }

    try {
      await input.run.end(
        input.outputs ?? {},
        input.error,
        Date.now(),
        input.metadata,
      );
      await input.run.patchRun();
    } catch {
      // tracing 失败不阻断主链路
    }
  }

  async withRunTree<T>(
    run: RunTree | undefined,
    fn: () => Promise<T>,
  ): Promise<T> {
    if (!run) {
      return fn();
    }

    return withRunTree(run, fn);
  }

  buildLlmTrace(input: {
    runName: string;
    metadata?: Record<string, unknown>;
    tags?: string[];
  }): LangsmithTraceOptions | undefined {
    if (!this.configService.langsmithTracing) {
      return undefined;
    }

    return {
      name: input.runName,
      client: this.getClient(),
      project_name: this.configService.langsmithProject,
      tracingEnabled: true,
      metadata: {
        project: this.configService.langsmithProject,
        ...(input.metadata ?? {}),
      },
      tags: input.tags ?? [],
    };
  }

  async flush() {
    if (!this.client) {
      return;
    }

    try {
      await this.client.flush();
    } catch {
      // flush 失败不阻断主链路
    }
  }

  private getClient(): Client {
    if (!this.client) {
      this.client = new Client({
        apiKey: this.configService.langsmithApiKey,
        apiUrl: this.configService.langsmithEndpoint,
        workspaceId: this.configService.langsmithWorkspaceId,
        blockOnRootRunFinalization: true,
      });
    }

    return this.client;
  }
}
