import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/overpass/latin-400.css";
import "@fontsource/overpass/latin-600.css";
import "@fontsource/overpass/latin-800.css";
import "@fontsource/overpass-mono/latin-400.css";
import "@fontsource/overpass-mono/latin-600.css";
import "@fontsource/spectral/latin-400.css";
import "@fontsource/spectral/latin-400-italic.css";
import "@fontsource/spectral/latin-600.css";
import "@fontsource/courier-prime/latin-400.css";
import "@fontsource/courier-prime/latin-700.css";
import "@fontsource/ibm-plex-sans-condensed/latin-400.css";
import "@fontsource/ibm-plex-sans-condensed/latin-500.css";
import "@fontsource/ibm-plex-sans-condensed/latin-600.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import { App } from "./ui/App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
