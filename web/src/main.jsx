import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import App from "./App.jsx";
import Home from "./pages/Home.jsx";
import "./styles.css";

// Chart-heavy pages are split out so the landing page loads instantly.
const Player = lazy(() => import("./pages/Player.jsx"));
const Compare = lazy(() => import("./pages/Compare.jsx"));
const About = lazy(() => import("./pages/About.jsx"));

const fallback = (
  <div className="empty">
    <span className="spinner" /> Loading…
  </div>
);
const lazyEl = (el) => <Suspense fallback={fallback}>{el}</Suspense>;

const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <Home /> },
      { path: "player/:id", element: lazyEl(<Player />) },
      { path: "compare", element: lazyEl(<Compare />) },
      { path: "about", element: lazyEl(<About />) },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
