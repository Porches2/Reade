import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        brand: {
          50: "#ECEFFE",
          100: "#DDE1FD",
          200: "#BCC3FB",
          300: "#9AA4F7",
          400: "#7984F5",
          500: "#5865F2",
          600: "#4752D9",
          700: "#3640B3",
          800: "#282F8C",
          900: "#1C2066",
        },
      },
    },
  },
  plugins: [],
};
export default config;
