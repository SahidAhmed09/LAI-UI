import { useEffect } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useLocation,
  useNavigate,
} from "react-router";
import { Toaster } from "sonner";

import { ThemeProvider } from "@/react-app/contexts/ThemeContext";
import { OnboardingProvider } from "@/react-app/contexts/OnboardingContext";

import { AuthProvider } from "@/react-app/auth";
import { ProtectedRoute } from "@/react-app/components/ProtectedRoute";
import LandingPage from "@/react-app/pages/Landing";
import LoginPage from "@/react-app/pages/Login";
import SignupPage from "@/react-app/pages/Signup";
import ForgotPasswordPage from "@/react-app/pages/ForgotPassword";
import ResetPasswordPage from "@/react-app/pages/ResetPassword";
import DashboardLayout from "@/react-app/components/DashboardLayout";
import DashboardPage from "@/react-app/pages/Dashboard";
import DashboardChatPage from "@/react-app/pages/DashboardChat";
import DashboardLibraryPage from "@/react-app/pages/DashboardLibrary";
import DashboardProjectsPage from "@/react-app/pages/DashboardProjects";
import DashboardSettingsPage from "@/react-app/pages/DashboardSettings";
import DashboardAdminPage from "@/react-app/pages/DashboardAdmin";
import AcceptInvitePage from "@/react-app/pages/AcceptInvite";

// Honors the demo seed-loader contract documented in
// ``LAI/scripts/ops/load_demo_matter.py``:
//
//   Open the demo at:  <frontend>/?session_id=lamstedt-demo
//
// The marketing landing page is fine for the root URL in normal use,
// but when a ``session_id`` is on the query string the operator wants
// the lawyer dropped straight into the seeded chat — no extra click.
// Forwarding the query string is what makes DashboardLayout's mount-time
// reader pick up the id and rehydrate the matter.
//
// We only redirect from the root path so an authenticated user clicking
// a deep-link in their conversation history isn't bounced around.
function DemoDeepLinkRedirect() {
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    if (location.pathname !== "/") return;
    const params = new URLSearchParams(location.search);
    if (!params.get("session_id")) return;
    navigate(`/dashboard/chat${location.search}`, { replace: true });
  }, [location.pathname, location.search, navigate]);
  return null;
}

export default function App() {
  return (
    <ThemeProvider>
      {/* Global toast surface — sonner. Used for things like "we'll email
          you when this is ready" on long-running DDiQ reports. */}
      <Toaster position="bottom-right" richColors closeButton />
       <Router>
        <AuthProvider>
          <DemoDeepLinkRedirect />
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            {/* Public accept-invite — the URL's ?token=... IS the auth. */}
            <Route path="/accept-invite" element={<AcceptInvitePage />} />
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <OnboardingProvider>
                    <DashboardLayout />
                  </OnboardingProvider>
                </ProtectedRoute>
              }
            >
              <Route index element={<DashboardPage />} />
              <Route path="chat" element={<DashboardChatPage />} />
              <Route path="documents" element={<DashboardLibraryPage />} />
              <Route path="projects" element={<DashboardProjectsPage />} />
              {/* Risk Assessment was merged into Documents & Reports. Keep the
                  old path working for bookmarks/links by redirecting. */}
              <Route path="risk" element={<Navigate to="/dashboard/documents" replace />} />
              <Route path="settings" element={<DashboardSettingsPage />} />
              <Route path="admin" element={<DashboardAdminPage />} />
            </Route>
          </Routes>
        </AuthProvider>
       </Router>
    </ThemeProvider>
  );
}
