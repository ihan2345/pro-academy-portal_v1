import { BookingForm } from "@/components/camps/booking";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ product?: string; channel?: string }>;
}) {
  return (
    <BookingForm
      campId={(await params).id}
      productId={(await searchParams).product}
      channel={(await searchParams).channel}
    />
  );
}
