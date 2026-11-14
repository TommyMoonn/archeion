import { useState } from "react";
import { BookOpen } from "lucide-react";
import Link from "@docusaurus/Link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function FoundationControls() {
  const [submitted, setSubmitted] = useState(false);

  return (
    <section aria-label="Component tooling sample" className="max-w-md space-y-4 py-4">
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitted(true);
        }}
      >
        <label htmlFor="foundation-title" className="block text-foreground">
          Sample book title
        </label>
        <Input id="foundation-title" name="title" autoComplete="off" />
        <div className="flex flex-wrap gap-3">
          <Button type="submit">
            <BookOpen aria-hidden="true" className="size-4" />
            Test component
          </Button>
          <Button type="button" variant="secondary" disabled>
            Unavailable sample
          </Button>
        </div>
        <p role="status" className="min-h-6 text-foreground">
          {submitted ? "Keyboard activation works." : ""}
        </p>
      </form>
      <Button asChild variant="outline">
        <Link to="/docs/foundation">Open the component documentation</Link>
      </Button>
    </section>
  );
}
