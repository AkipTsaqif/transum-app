/** @type {import('next').NextConfig} */
const nextConfig = {
    // Explicit: the overview layer is ~785 KB of JSON that gzips to ~131 KB.
    // Most hosts compress at the edge, but `next start` does not do it for
    // route handlers by default, so self-hosted deployments would ship the
    // full payload. Turning it on here makes the behaviour the same everywhere.
    compress: true,
};

module.exports = nextConfig;
