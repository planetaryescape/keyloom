import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { BoardDevApp } from "./boarddev/BoardDevApp.tsx";
import { tokenFromSearch } from "./api.ts";
import { Header } from "./shell/Header.tsx";
import { ErrorState } from "./shell/States.tsx";
import { applyTheme, readTheme } from "./shell/theme.ts";
import "./fonts/fonts.css";
import "./tokens.css";
import "./app.css";
import "./shell/shell.css";

const root = document.getElementById("root");
if (!root) throw new Error("keyloom: missing #root element");

// Before the first paint, so a stored dark theme never flashes light.
applyTheme(readTheme());

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
    // `keyloom serve --board-dev` puts the mode in the link it prints.
    new URLSearchParams(window.location.search).get("mode") === "board-dev" ? <BoardDevApp token={token} /> : <App token={token} />
  ),
);
