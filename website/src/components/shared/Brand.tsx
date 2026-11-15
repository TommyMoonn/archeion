import darkLogo from "@/assets/brand/archeion-logo-dark.png";
import lightLogo from "@/assets/brand/archeion-logo-light.png";
import { cn } from "@/lib/utils";

export function Brand({ className }: { className?: string }) {
  return (
    <span
      className={cn("inline-flex items-center gap-2.5 whitespace-nowrap font-editorial", className)}
    >
      <img src={darkLogo} alt="" width={34} height={34} className="hidden size-8.5 dark:block" />
      <img src={lightLogo} alt="" width={34} height={34} className="block size-8.5 dark:hidden" />
      <span className="text-xl leading-none tracking-display text-content-strong">Archeion</span>
    </span>
  );
}
