import Link from "@docusaurus/Link";
import FoundationNotice from "@site/src/components/FoundationNotice";
import FoundationControls from "@site/src/components/FoundationControls";
import FoundationTokens from "@site/src/components/FoundationTokens";

export default function FoundationPage() {
  return (
    <main>
      <h1>Archeion website foundation</h1>
      <FoundationNotice />
      <FoundationControls />
      <FoundationTokens />
      <Link to="/docs/foundation">Open the temporary documentation</Link>
    </main>
  );
}
