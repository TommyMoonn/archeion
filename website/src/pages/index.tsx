import Head from "@docusaurus/Head";
import { LandingPage } from "@/components/landing/LandingPage";
import { landingMetadata as metadata } from "@/components/landing/content";

export default function Home() {
  return (
    <>
      <Head>
        <title>{metadata.title}</title>
        <meta name="description" content={metadata.description} />
        <link rel="canonical" href={metadata.url} />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="Archeion" />
        <meta property="og:title" content={metadata.title} />
        <meta property="og:description" content={metadata.description} />
        <meta property="og:url" content={metadata.url} />
        <meta property="og:image" content={metadata.image} />
        <meta property="og:image:width" content="1544" />
        <meta property="og:image:height" content="1012" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={metadata.title} />
        <meta name="twitter:description" content={metadata.description} />
        <meta name="twitter:image" content={metadata.image} />
      </Head>
      <LandingPage />
    </>
  );
}
