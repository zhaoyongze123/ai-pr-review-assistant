import {
  ConnectedSocket,
  OnGatewayInit,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { Inject, OnModuleDestroy } from "@nestjs/common";
import type { Server, Socket } from "socket.io";
import { z } from "zod";
import { ReviewEventsService } from "./review-events.service.js";

const ReviewJobSubscriptionSchema = z.object({
  reviewJobId: z.string().uuid(),
});

@WebSocketGateway({
  namespace: "/review-events",
  cors: {
    origin: true,
    credentials: true,
  },
})
export class ReviewEventsGateway implements OnGatewayInit, OnModuleDestroy {
  private readonly unsubscribers: Array<() => void> = [];

  constructor(
    @Inject(ReviewEventsService)
    private readonly reviewEventsService: ReviewEventsService,
  ) {}

  @WebSocketServer()
  server?: Server;

  @SubscribeMessage("subscribe_review_job")
  handleSubscribe(
    @MessageBody() body: unknown,
    @ConnectedSocket() client: Socket,
  ) {
    const payload = ReviewJobSubscriptionSchema.parse(body);
    client.join(toReviewJobRoom(payload.reviewJobId));

    return {
      ok: true,
      reviewJobId: payload.reviewJobId,
    };
  }

  afterInit() {
    this.unsubscribers.push(
      this.reviewEventsService.subscribe("review_job_progress", (event) => {
        this.server
          ?.to(toReviewJobRoom(event.payload.reviewJobId))
          .emit(event.eventName, event);
      }),
    );
    this.unsubscribers.push(
      this.reviewEventsService.subscribe("file_review_completed", (event) => {
        this.server
          ?.to(toReviewJobRoom(event.payload.reviewJobId))
          .emit(event.eventName, event);
      }),
    );
  }

  onModuleDestroy() {
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
  }
}

function toReviewJobRoom(reviewJobId: string) {
  return `review-job:${reviewJobId}`;
}
