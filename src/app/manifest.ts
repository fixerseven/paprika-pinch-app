import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Pinch",
    short_name: "Pinch",
    description: "One place to approve every post.",
    start_url: "/",
    display: "standalone",
    background_color: "#fffdf7",
    theme_color: "#fffdf7",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
