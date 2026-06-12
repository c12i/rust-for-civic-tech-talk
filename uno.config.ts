import { defineConfig } from "unocss";

// Extends Slidev's built-in UnoCSS config with Bunge Hub's design tokens.
export default defineConfig({
  theme: {
    colors: {
      bg: "#fffdf9",
      surface: "#f5f2ec",
      border: "#e5e1d8",
      text: "#1c1917",
      muted: "#78716c",
      accent: "#9b3030",
      gold: "#c8a45f",
    },
  },
});
