import { Injectable } from "@nestjs/common";
import { createContextFetchPlan } from "@ai-pr-review/review-core";
import type {
  ContextBudget,
  ContextFetchResult,
  ContextRequest,
} from "@ai-pr-review/shared-types";

@Injectable()
export class ContextFetcherService {
  createPlan(
    request: ContextRequest,
    budget: ContextBudget,
  ): ContextFetchResult {
    return createContextFetchPlan(request, budget);
  }
}
