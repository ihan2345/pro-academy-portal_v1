import type { CampBookingStatus } from "@/lib/camps/domain";

export function BookingStatusButton({
  status,
}: {
  status: NonNullable<CampBookingStatus>;
}) {
  return (
    <button
      type="button"
      className={`secondary-button camp-booking-status ${status}`}
      disabled
    >
      {status === "paid" ? "Angemeldet / bestätigt" : "Buchung wird geprüft"}
    </button>
  );
}
