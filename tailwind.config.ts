import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Swarmwright dark palette — warm near-black, copper accent
        ink: {
          950: "#0c0b09",
          900: "#12110e",
          850: "#171611",
          800: "#1d1c16",
          700: "#2a2820",
          600: "#3a372c",
          500: "#54503f",
        },
        copper: {
          300: "#e8b07f",
          400: "#dd9660",
          500: "#c97c43",
          600: "#a96435",
          700: "#874e2b",
        },
        sage: { 400: "#8fae8b", 500: "#6f9470" },
        ember: { 400: "#e0725c", 500: "#c9573f" },
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};
export default config;
