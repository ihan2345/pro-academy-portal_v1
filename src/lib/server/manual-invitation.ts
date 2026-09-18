import "server-only";
import { randomBytes, createHash } from "node:crypto";
import { serviceDb } from "./service-db";
import { HttpError } from "./security";
export async function releaseManualInvitation(
  parentId: string,
  actorId: string,
) {
  if (
    process.env.CAMP_SIDE_EFFECTS_BLOCKED === "true" ||
    process.env.MANUAL_INVITATIONS_ENABLED !== "true"
  )
    throw new HttpError(
      403,
      "Manuelle Einladungen sind noch nicht freigegeben.",
    );
  const origin = process.env.APP_URL;
  if (origin !== "https://proacademy-portal.proacademy-by-ak.workers.dev")
    throw new HttpError(503, "Einladungsadresse ist nicht freigegeben.");
  const token = randomBytes(32).toString("hex");
  const result = await serviceDb().rpc("release_parent_invitation", {
    input: {
      parent_id: parentId,
      actor_id: actorId,
      token_hash: createHash("sha256").update(token).digest("hex"),
      url: `${origin}/einladung?token=${token}`,
    },
  });
  if (result.error)
    throw new HttpError(
      400,
      "Einladung nicht freigegeben. Elternkonto und Empfängerfreigabe prüfen.",
    );
  return result.data;
}
