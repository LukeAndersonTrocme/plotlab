import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// BASE is set by CI for GitHub Pages (e.g. /plotlab/).
export default defineConfig({
  base: process.env.BASE ?? "/",
  plugins: [react()],
  worker: { format: "es" },
});
