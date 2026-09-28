import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";

const API_BASE = "http://127.0.0.1:8000";
const nativeFetch = window.fetch.bind(window);

window.fetch = (input, init = {}) => {
  const url = typeof input === "string" ? input : input?.url || String(input);

  if (!url.startsWith(API_BASE)) {
    return nativeFetch(input, init);
  }

  const headers = new Headers(init.headers || input?.headers || {});
  const token = sessionStorage.getItem("auth_token");

  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  return nativeFetch(input, {
    ...init,
    headers,
  });
};

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
