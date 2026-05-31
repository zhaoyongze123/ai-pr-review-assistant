import { EventEmitter } from "node:events";
import { Injectable } from "@nestjs/common";
import {
  FileReviewCompletedEventSchema,
  ReviewJobProgressEventSchema,
  type FileReviewCompletedEvent,
  type ReviewJobProgressEvent,
} from "@ai-pr-review/shared-types";

type ReviewEventName = "review_job_progress" | "file_review_completed";

@Injectable()
export class ReviewEventsService {
  private readonly emitter = new EventEmitter();

  emitReviewJobProgress(event: ReviewJobProgressEvent) {
    this.emitter.emit(
      "review_job_progress",
      ReviewJobProgressEventSchema.parse(event),
    );
  }

  emitFileReviewCompleted(event: FileReviewCompletedEvent) {
    this.emitter.emit(
      "file_review_completed",
      FileReviewCompletedEventSchema.parse(event),
    );
  }

  subscribe<TEvent extends ReviewJobProgressEvent | FileReviewCompletedEvent>(
    eventName: ReviewEventName,
    listener: (event: TEvent) => void,
  ) {
    this.emitter.on(eventName, listener as (...args: unknown[]) => void);
    return () => {
      this.emitter.off(eventName, listener as (...args: unknown[]) => void);
    };
  }
}
