import React from "react";
import {createRoot} from "react-dom/client";
import {Portal,Stamps} from "../../src/components/portal";
import {SubscriptionReviews} from "../../src/components/subscription-reviews";
import {portalFixture} from "../fixtures/portal";
createRoot(document.getElementById("root")!).render(
 <Portal initial={{...portalFixture,role:"admin",players:[],events:[]}} section="admin">
  <div className="page-heading"><h1>Übersicht</h1></div>
  <SubscriptionReviews/>
  <section className="panel" style={{padding:24}}><h2>FirstTouch · 6 von 4 Einheiten</h2><p>Beispiel nach sofortigem Downgrade</p>
   <Stamps period={{id:"demo",player_id:"demo",subscription_id:"demo",product_name:"FirstTouch",starts_at:"2026-10-01",ends_at:"2026-11-01",included_units:4,status:"active"}} completed={6} planned={0}/>
  </section>
 </Portal>
);
