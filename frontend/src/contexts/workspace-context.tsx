import { useQuery } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useLocation } from "react-router-dom";
import { listOrganizations } from "../api/endpoints";
import type { Organization } from "../types/business";

const STORAGE_KEY = "alveryn.active-workspace";

type WorkspaceContextValue = {
  organizations: Organization[];
  activeWorkspace: Organization | null;
  activeWorkspaceId: string | null;
  isLoading: boolean;
  setActiveWorkspaceId: (organizationId: string) => void;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function storedWorkspaceId() {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function persistWorkspaceId(organizationId: string) {
  try {
    window.localStorage.setItem(STORAGE_KEY, organizationId);
  } catch {
    // Storage can be unavailable in private or embedded browser contexts.
  }
}

function workspaceIdFromPath(pathname: string) {
  return pathname.match(/^\/business\/([^/]+)/)?.[1] ?? null;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const organizationsQuery = useQuery({
    queryKey: ["organizations"],
    queryFn: listOrganizations,
  });
  const organizations = useMemo(
    () => organizationsQuery.data ?? [],
    [organizationsQuery.data],
  );
  const [selectedId, setSelectedId] = useState<string | null>(storedWorkspaceId);
  const routeWorkspaceId = workspaceIdFromPath(location.pathname);
  const validSelectedId = organizations.some((item) => item.id === selectedId)
    ? selectedId
    : null;
  const businessIndexWorkspaceId =
    location.pathname === "/business"
      ? organizations.find(
          (item) => item.id === validSelectedId && item.type === "BUSINESS",
        )?.id ?? organizations.find((item) => item.type === "BUSINESS")?.id ?? null
      : null;
  const activeWorkspaceId =
    (routeWorkspaceId && organizations.some((item) => item.id === routeWorkspaceId)
      ? routeWorkspaceId
      : null) ??
    businessIndexWorkspaceId ??
    validSelectedId ??
    organizations.find((item) => item.type === "PERSONAL")?.id ??
    organizations[0]?.id ??
    null;

  useEffect(() => {
    if (!activeWorkspaceId) return;
    setSelectedId(activeWorkspaceId);
    persistWorkspaceId(activeWorkspaceId);
  }, [activeWorkspaceId]);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      organizations,
      activeWorkspace:
        organizations.find((item) => item.id === activeWorkspaceId) ?? null,
      activeWorkspaceId,
      isLoading: organizationsQuery.isLoading,
      setActiveWorkspaceId: (organizationId) => {
        setSelectedId(organizationId);
        persistWorkspaceId(organizationId);
      },
    }),
    [activeWorkspaceId, organizations, organizationsQuery.isLoading],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error("useWorkspace must be used inside WorkspaceProvider");
  }
  return context;
}

/**
 * Lets reusable Business layout components retain their standalone test and
 * prototype support. The application itself continues to use useWorkspace,
 * which intentionally requires the provider.
 */
export function useOptionalWorkspace() {
  return useContext(WorkspaceContext);
}
