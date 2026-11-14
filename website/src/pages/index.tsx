import Link from "@docusaurus/Link";
import FoundationNotice from "@site/src/components/FoundationNotice";
import FoundationControls from "@site/src/components/FoundationControls";

export default function FoundationPage() {
  return (
    <main>
      <h1>Archeion website foundation</h1>
      <FoundationNotice />
      <FoundationControls />
      <Link to="/docs/foundation">Open the temporary documentation</Link>
    </main>
  );
}
