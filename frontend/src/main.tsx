import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/manrope/600.css";
import "@fontsource/manrope/700.css";
import "@fontsource/sora/500.css";
import "@fontsource/sora/600.css";
import "./styles/index.css";
import "./i18n";

import React from "react";
import ReactDOM from "react-dom/client";
import { MotionConfig } from "framer-motion";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router-dom";
import { AuthProvider } from "./features/auth/auth-provider";
import { GlobalPullToRefresh } from "./components/navigation/global-pull-to-refresh";
import { createAppRouter } from "./routes/router";
import { queryClient } from "./api/query-client";
import { registerServiceWorker } from "./register-service-worker";
import { applyAppTheme, initializeSystemThemeListener } from "./utils/theme";

const router = createAppRouter();

registerServiceWorker();
applyAppTheme("SYSTEM");
initializeSystemThemeListener();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MotionConfig reducedMotion="user">
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <GlobalPullToRefresh />
          <RouterProvider router={router} />
        </AuthProvider>
      </QueryClientProvider>
    </MotionConfig>
  </React.StrictMode>
);
