import React from "react";
import { createRoot } from "react-dom/client";
import { LoginForm } from "../../src/components/login";
const playerId =
  new URLSearchParams(location.search).get("player") ?? undefined;
createRoot(document.getElementById("root")!).render(
  <LoginForm playerId={playerId} />,
);
