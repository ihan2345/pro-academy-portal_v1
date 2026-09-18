import { campLocalEnabled, campPublicOrigin } from "./runtime";

export function campServerReviewEnabled() {
  return (
    !campLocalEnabled() &&
    !!campPublicOrigin() &&
    process.env.CAMP_REVIEW_ENABLED === "true"
  );
}
export function campProcessingEnabled() {
  return (
    campServerReviewEnabled() &&
    process.env.CAMP_PROCESSING_ENABLED === "true" &&
    process.env.CAMP_SIDE_EFFECTS_BLOCKED !== "true"
  );
}
export function campReviewEnabled() {
  return campLocalEnabled()
    ? process.env.CAMP_LOCAL_REVIEW_ENABLED === "true"
    : campServerReviewEnabled();
}
