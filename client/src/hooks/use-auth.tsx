import { useQuery } from "@tanstack/react-query";
import { User as SelectUser } from "@shared/schema";

export function useAuth() {
  const { data: user, isLoading, error } = useQuery<SelectUser | null>({
    queryKey: ["/api/auth/user"],
    retry: false,
    staleTime: Infinity,
  });

  return {
    user: user ?? null,
    isLoading,
    isAuthenticated: !!user,
    error,
  };
}
