import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { tokenFromSearch } from "./api.ts";
import "./app.css";

const root = document.getElementById("root");
if (!root) throw new Error("keyloom: missing #root element");

const token = tokenFromSearch(window.location.search);
createRoot(root).render(
  token === null ? (
    <p className="app-message">Open the link keyloom printed. It includes the token this page needs.</p>
  ) : (
    <App token={token} />
  ),
);
