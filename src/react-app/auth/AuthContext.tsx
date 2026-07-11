import { createContext } from "react";
import type { AuthContextValue } from "./types";

// Created here (and not inside the provider file) so the hook can
// safely live in its own module without a circular import: the hook
// imports the context, the provider also imports the context, but
// neither pulls the other.
export const AuthContext = createContext<AuthContextValue | undefined>(undefined);
