import { Badge } from "@/components/ui/Badge";

export function Hero() {
  return (
    <section className="mb-8 animate-fade-up">
      <div className="mb-3 flex items-center gap-2">
        <Badge tone="violet">Soroban · SEP-40 Reflector</Badge>
        <Badge tone="neutral">European · Cash-settled</Badge>
      </div>
      <h1 className="text-3xl font-semibold tracking-tight text-umbra-ink sm:text-4xl">
        Options, priced in the open.
      </h1>
      <p className="mt-2 max-w-xl text-sm text-umbra-muted sm:text-base">
        Buy and write fully-collateralized calls and puts against a pooled AMM. Every premium is
        quoted live off Reflector's oracle feed — no order book, no counterparty risk.
      </p>
    </section>
  );
}
