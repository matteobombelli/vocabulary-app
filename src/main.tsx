import "@fontsource-variable/figtree";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { APP_BASE } from "../shared/api";
import App from "./App";
import { RequireAuth } from "./auth/RequireAuth";
import AssessmentPage from "./routes/AssessmentPage";
import CoursePage from "./routes/CoursePage";
import HomePage from "./routes/HomePage";
import LoginPage from "./routes/LoginPage";
import RegisterPage from "./routes/RegisterPage";
import SettingsPage from "./routes/SettingsPage";
import StudyPage from "./routes/StudyPage";
import WordsPage from "./routes/WordsPage";
import "./styles.css";

const router = createBrowserRouter(
  [
    {
      path: "/",
      element: <App />,
      children: [
        { path: "login", element: <LoginPage /> },
        { path: "register", element: <RegisterPage /> },
        {
          element: <RequireAuth />,
          children: [
            { index: true, element: <HomePage /> },
            { path: ":lang", element: <CoursePage /> },
            { path: ":lang/assessment", element: <AssessmentPage /> },
            { path: ":lang/learn", element: <StudyPage mode="learn" /> },
            { path: ":lang/review", element: <StudyPage mode="review" /> },
            { path: ":lang/words", element: <WordsPage /> },
            { path: ":lang/settings", element: <SettingsPage /> },
          ],
        },
      ],
    },
  ],
  { basename: APP_BASE }
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
);
