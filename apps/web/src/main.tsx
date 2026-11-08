import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import "./styles.css";
import { Layout } from "./ui/Layout.tsx";
import { Toasts } from "./ui/Toasts.tsx";
import { ConfirmHost } from "./ui/Confirm.tsx";
import { Home } from "./pages/Home.tsx";
import { Room } from "./pages/Room.tsx";
import { Leaderboard } from "./pages/Leaderboard.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/leaders" element={<Leaderboard />} />
          <Route path="/room/:code" element={<Room />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </Layout>
      <Toasts />
      <ConfirmHost />
    </BrowserRouter>
  </StrictMode>,
);

