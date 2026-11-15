import type { ReactNode } from "react";
import Head from "@docusaurus/Head";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import { useLocation } from "@docusaurus/router";

export default function Root({ children }: { children: ReactNode }) {
  const { siteConfig } = useDocusaurusContext();
  const { pathname } = useLocation();
  const home = pathname === siteConfig.baseUrl;
  const icon = `${siteConfig.baseUrl}assets/images/archeion-icon.png`;
  const homeIcon = new URL(icon, siteConfig.url).href;
  return (
    <>
      <Head>
        <link rel="icon" href={home ? homeIcon : icon} />
        <link
          rel="apple-touch-icon"
          href={home ? homeIcon : `${siteConfig.baseUrl}assets/archeion-icon.png`}
        />
      </Head>
      {children}
    </>
  );
}
