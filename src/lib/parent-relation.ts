// Beziehung zum Kind je Elternkonto (profiles.child_relation, Release 054).
export const CHILD_RELATIONS = [
  { id: "mutter", label: "Mutter" },
  { id: "vater", label: "Vater" },
  { id: "elternteil", label: "Elternteil" },
  { id: "stiefmutter", label: "Stiefmutter" },
  { id: "stiefvater", label: "Stiefvater" },
  { id: "grossmutter", label: "Großmutter" },
  { id: "grossvater", label: "Großvater" },
  { id: "vormund", label: "Vormund" },
  { id: "sonstige", label: "Andere Bezugsperson" },
] as const;
export type ChildRelation = (typeof CHILD_RELATIONS)[number]["id"];
export const CHILD_RELATION_IDS = CHILD_RELATIONS.map((r) => r.id) as [
  ChildRelation,
  ...ChildRelation[],
];
export function relationLabel(id: string | null | undefined) {
  return CHILD_RELATIONS.find((r) => r.id === id)?.label ?? null;
}
