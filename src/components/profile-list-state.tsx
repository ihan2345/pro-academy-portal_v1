"use client";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

function useListState() {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("name");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [offset, setOffset] = useState(0);
  return {
    search,
    setSearch,
    sort,
    setSort,
    includeInactive,
    setIncludeInactive,
    offset,
    setOffset,
  };
}
const ListState = createContext<ReturnType<typeof useListState> | null>(null);

/** Survives list/detail navigation; leaving the area ends the selection scope. */
export function ProfileListStateProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const state = useListState();
  const pathname = usePathname();
  const area =
    /^\/(admin|team)\/elternprofile(?:\/|$)/.exec(pathname ?? "")?.[1] ?? null;
  const previousArea = useRef(area);
  const { setSearch, setSort, setIncludeInactive, setOffset } = state;
  useEffect(() => {
    if (!area || previousArea.current !== area) {
      setSearch("");
      setSort("name");
      setIncludeInactive(false);
      setOffset(0);
    }
    previousArea.current = area;
  }, [area, setSearch, setSort, setIncludeInactive, setOffset]);
  return <ListState.Provider value={state}>{children}</ListState.Provider>;
}
export function useProfileListState() {
  const state = useContext(ListState);
  if (!state) throw new Error("Profile list state provider is missing");
  return state;
}
