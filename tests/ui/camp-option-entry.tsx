import React from "react";
import { createRoot } from "react-dom/client";
import { ProductStore } from "../../src/components/products/store";
import { AdminProducts } from "../../src/components/products/admin";
import { NewCamp } from "../../src/components/camps/dashboard";
import { CampBookingOptionEditor } from "../../src/components/camps/booking-option-editor";
import { BookingForm } from "../../src/components/camps/booking";
const camp = {
  id: "90000000-0000-4000-8000-000000000001",
  title: "Camp Test",
  location: "Testplatz",
  description: "Testcamp",
  payment_mode: "test" as const,
  capacity: 30,
  buffer_percent: 10,
  min_age: 5,
  max_age: 18,
  status: "open",
  days: [
    { starts_at: "2027-04-01T09:00:00Z", ends_at: "2027-04-01T15:00:00Z" },
  ],
  early_bird_until: null,
  booking_option: {
    amount: 7900,
    title: "Tagesoption",
    description: "Nur einen Camp-Tag buchen",
    alert: "Bitte den gewünschten Tag mit unserem Team abstimmen.",
  },
  booking_option_version: 2,
};
const path = location.pathname;
createRoot(document.getElementById("root")!).render(
  path === "/camp/new" ? (
    <NewCamp
      locations={[{ id: camp.id, name: "Testplatz", address: "Testweg" }]}
      saved={() => {}}
    />
  ) : path === "/camp/edit" ? (
    <CampBookingOptionEditor camp={camp} onChanged={async () => {}} />
  ) : path.startsWith("/camp/buchung/") ? (
    <BookingForm campId={camp.id} />
  ) : path.startsWith("/admin") ? (
    <AdminProducts />
  ) : (
    <ProductStore />
  ),
);
