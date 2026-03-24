import type { Review } from "./types";

const reviews: Review[] = [];
let nextReviewId = 1;

export function listReviews() {
  return reviews.slice().sort((a, b) => b.createdAt - a.createdAt);
}

export function createReview(input: {
  pickupId?: number;
  rating: 1 | 2 | 3 | 4 | 5;
  text?: string;
  konsierUserId?: string;
  konsierConversationId?: string | number;
  attachments?: Review["attachments"];
  location?: Review["location"];
}) {
  const review: Review = {
    id: nextReviewId++,
    rating: input.rating,
    createdAt: Date.now(),
  };

  if (input.pickupId !== undefined) review.pickupId = input.pickupId;
  if (input.text !== undefined) review.text = input.text;
  if (input.konsierUserId) review.konsierUserId = input.konsierUserId;
  if (input.konsierConversationId !== undefined)
    review.konsierConversationId = input.konsierConversationId;
  if (input.attachments && input.attachments.length > 0)
    review.attachments = input.attachments;
  if (input.location) review.location = input.location;

  reviews.push(review);
  return review;
}

