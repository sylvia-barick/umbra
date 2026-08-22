import Link from "next/link";
import { ConnectButton } from "@/components/ConnectButton";
import { UmbraMark } from "@/components/UmbraMark";

export function Navbar() {
  return (
    <header className="sticky top-0 z-30 border-b border-umbra-border-soft bg-umbra-bg/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2.5">
          <UmbraMark className="h-7 w-7" />
          <span className="text-lg font-semibold tracking-tight">Umbra</span>
          <span className="ml-1 hidden rounded-full border border-umbra-border bg-white/5 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-umbra-faint sm:inline">
            Testnet
          </span>
        </Link>
        <ConnectButton />
      </div>
    </header>
  );
}
