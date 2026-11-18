import { textMailHtml, type MailLook } from "../mail-2026/from-text";
export function trialEmailDesign(input: {
  title: string;
  text: string;
  access: string;
  actions: { label: string; url: string }[];
  ratingLinks?: string[];
  customerNotice?: boolean;
  look?: MailLook;
}) {
  const paragraphs = input.text
    .split("\n")
    .filter(
      (line) =>
        line.trim() &&
        !/^https?:/.test(line.trim()) &&
        !line.includes(input.access) &&
        ![
          "Euer ProAcademy-Team",
          "contact@proacademy-ak.com",
          "+49 151 433 423 92",
        ].includes(line.trim()),
    );
  return textMailHtml(
    input.title,
    paragraphs.join("\n"),
    input.access,
    input.actions.filter((a) => a.url !== input.access),
    {
      area: input.customerNotice ? "Training" : "Probetraining",
      eyebrow: input.title.includes(": ")
        ? undefined
        : input.customerNotice
          ? "Euer Training"
          : "Euer Probetraining",
      primaryLabel: input.customerNotice
        ? "Euer Trainingsportal"
        : "Euer Willkommensportal",
      signature: "Euer ProAcademy-Team",
      rating: input.ratingLinks
        ? {
            title: input.customerNotice
              ? "Wie war euer Training?"
              : "Wie war euer Probetraining?",
            text: "Ein Klick speichert eure Bewertung. Danach seht ihr eure Sterne und könnt einmalig eine persönliche Nachricht ergänzen.",
            urls: input.ratingLinks,
          }
        : undefined,
      ...input.look,
    },
  );
}
