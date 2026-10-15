import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { tokenFromSearch } from "./api.ts";
import { Header } from "./shell/Header.tsx";
import { ErrorState } from "./shell/States.tsx";
import "./tokens.css";
import "./app.css";

const root = document.getElementById("root");
if (!root) throw new Error("keyloom: missing #root element");

const token = tokenFromSearch(window.location.search);
createRoot(root).render(
  token === null ? (
    <div className="app">
      <Header />
      <main className="app-main">
        <ErrorState title="This page needs keyloom's link">
          Open the link keyloom printed when it started. It includes the token this page needs.
        </ErrorState>
      </main>
    </div>
  ) : (
    <App token={token} />
  ),
);
