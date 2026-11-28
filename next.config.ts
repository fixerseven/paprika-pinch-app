import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  // OAuth discovery for the Claude connector lives under /.well-known.
  async rewrites() {
    return [
      { source: "/.well-known/oauth-protected-resource", destination: "/api/well-known/oauth-protected-resource" },
      { source: "/.well-known/oauth-protected-resource/:path*", destination: "/api/well-known/oauth-protected-resource" },
      { source: "/.well-known/oauth-authorization-server", destination: "/api/well-known/oauth-authorization-server" },
      { source: "/.well-known/oauth-authorization-server/:path*", destination: "/api/well-known/oauth-authorization-server" },
      { source: "/.well-known/openid-configuration", destination: "/api/well-known/oauth-authorization-server" },
    ];
  },
};

export default config;
