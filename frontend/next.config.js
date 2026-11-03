/** @type {import('next').NextConfig} */
const nextConfig = {
  // Old routes from before the workspace redesign keep working.
  async redirects() {
    return [
      { source: "/dashboard/campaigns", destination: "/dashboard/outreach", permanent: false },
      { source: "/dashboard/templates", destination: "/dashboard/outreach/templates", permanent: false },
      { source: "/dashboard/notifications", destination: "/dashboard/settings?tab=notifications", permanent: false },
      { source: "/company/:id", destination: "/dashboard/company?companyId=:id", permanent: false },
    ];
  },
};
module.exports = nextConfig;
