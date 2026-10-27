import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Navigate, createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import App from "./App";
import { RequireAuth } from "./auth/RequireAuth";
import { lastCourse } from "./lastCourse";
import AssessmentPage from "./routes/AssessmentPage";
import CoursePage from "./routes/CoursePage";
import LoginPage from "./routes/LoginPage";
import RegisterPage from "./routes/RegisterPage";
import SettingsPage from "./routes/SettingsPage";
import StudyPage from "./routes/StudyPage";
import WordsPage from "./routes/WordsPage";
import Shell from "./Shell";
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
            {
              element: <Shell />,
              children: [
                { index: true, element: <Navigate to={`/${lastCourse()}`} replace /> },
                { path: "settings", element: <SettingsPage /> },
                { path: ":lang", element: <CoursePage /> },
                { path: ":lang/assessment", element: <AssessmentPage /> },
                { path: ":lang/learn", element: <StudyPage mode="learn" /> },
                { path: ":lang/review", element: <StudyPage mode="review" /> },
                { path: ":lang/words", element: <WordsPage /> },
                { path: ":lang/settings", element: <Navigate to="/settings" replace /> },
              ],
            },
          ],
        },
      ],
    },
  ]
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
);
