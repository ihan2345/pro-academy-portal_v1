import React from "react";
import { createRoot } from "react-dom/client";
import { ProductStore } from "../../src/components/products/store";
createRoot(document.getElementById("root")!).render(<ProductStore />);
