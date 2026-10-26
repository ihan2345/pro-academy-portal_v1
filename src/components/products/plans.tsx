"use client";
import { useState } from "react";
import { AdminView } from "../admin";
import type { PortalData } from "@/lib/types";
export function ProductPlans({ initial }: { initial: PortalData }) {
  const [notice, setNotice] = useState("");
  return (
    <>
      {notice && <p role="status">{notice}</p>}
      <p>
        Diese Fachpläne bestimmen Trainingseinheiten. Zeitstunden werden am
        Verkaufsangebot gepflegt. Historische Kontingente behalten ihre
        bisherigen Regeln.
      </p>
      <AdminView data={initial} section="admin/produkte" notify={setNotice} />
    </>
  );
}
