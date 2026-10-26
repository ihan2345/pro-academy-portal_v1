import { notFound } from "next/navigation";
import { productShopEnabled } from "@/lib/server/products/runtime";
import { ProductStore } from "@/components/products/store";
import "@/components/products/products.css";
export const dynamic = "force-dynamic";
export default async function ProductsPage() {
  if (!(await productShopEnabled())) notFound();
  return <ProductStore />;
}
