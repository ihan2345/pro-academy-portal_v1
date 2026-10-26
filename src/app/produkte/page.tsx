import { notFound } from "next/navigation";
import { productShopEnabled } from "@/lib/server/products/runtime";
import { sessionUser } from "@/lib/server/supabase";
import { loadPortal } from "@/lib/server/data";
import { Portal } from "@/components/portal";
import { ProductStore } from "@/components/products/store";
import "@/components/products/products.css";
export const dynamic = "force-dynamic";
export default async function ProductsPage() {
  if (!(await productShopEnabled())) notFound();
  const session = await sessionUser();
  if (!session?.role) return <ProductStore />;
  const initial = await loadPortal("produkte");
  return (
    <Portal initial={initial} section="produkte">
      <ProductStore embedded portalRole={initial.role} />
    </Portal>
  );
}
