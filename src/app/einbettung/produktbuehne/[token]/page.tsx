import { ShowcaseEmbed } from "@/components/products/showcase-embed";
import "@/components/products/products.css";
import "@/components/products/showcase-embed.css";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  return <ShowcaseEmbed token={(await params).token} />;
}
