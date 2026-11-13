import React from "react";
import { createRoot } from "react-dom/client";
import { ProductStore } from "../../src/components/products/store";
import { AdminProducts } from "../../src/components/products/admin";
createRoot(document.getElementById("root")!).render(
  location.pathname.startsWith("/admin") ? <AdminProducts /> : <ProductStore />,
);
