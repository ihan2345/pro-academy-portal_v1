import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  TrialApplication,
  TrialWelcome,
} from "../../src/components/trials/public";
import {
  TrialTeam,
  TrialParticipantActions,
} from "../../src/components/trials/team";
import { Portal } from "../../src/components/portal";
import { portalFixture } from "../fixtures/portal";
import "../../src/components/trials/trials.css";
const camp = {
  id: "camp",
  title: "Herbstcamp",
  location: "Gelsenkirchen",
  starts_at: "2026-11-01T09:00:00Z",
};
function Manual() {
  const [trial, setTrial] = useState<string | null>(null);
  return (
    <div className="trial-card">
      <TrialParticipantActions
        participant={{
          id: "participant",
          player_id: "child",
          status: "planned",
          trial_request_id: trial,
        }}
        name="Emir"
        base="/admin"
        onMarked={setTrial}
      />
    </div>
  );
}
const screen = new URLSearchParams(location.search).get("screen");
createRoot(document.getElementById("root")!).render(
  screen === "team" ? (
    <Portal
      initial={{ ...portalFixture, role: "admin", trial_enabled: true }}
      section="admin/probetraining"
    >
      <TrialTeam />
    </Portal>
  ) : screen === "welcome" ? (
    <TrialWelcome
      family={{ name: "Mina Beispiel", marketing_consent: true }}
      rows={[
        {
          id: "request",
          event_id: "event",
          first_name: "Emir",
          last_name: "Beispiel",
          status: "attended",
          confirmed_at: "2026-10-20T14:00:00Z",
          starts_at: "2026-10-20T12:00:00Z",
          ends_at: "2026-10-20T13:00:00Z",
          event_title: "Techniktraining",
          event_status: "scheduled",
          attendance: "attended_manual",
          location_name: "Sportplatz",
          address: "Weg 1",
          coach_name: "Coach",
          academy_feedback: "Du hast aufmerksam mitgemacht. Weiter so!",
          academy_rating: 4,
          parent_rating: null,
          subscribed: false,
        },
      ]}
      camps={[camp]}
    />
  ) : screen === "manual" ? (
    <Manual />
  ) : (
    <TrialApplication camps={[camp]} />
  ),
);
