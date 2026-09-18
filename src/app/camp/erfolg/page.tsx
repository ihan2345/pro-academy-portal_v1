import { BookingResult } from "@/components/camps/result";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  return <BookingResult sessionId={(await searchParams).session_id ?? ""} />;
}
