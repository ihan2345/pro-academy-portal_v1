import { BookingForm } from "@/components/camps/booking";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <BookingForm campId={(await params).id} />;
}
