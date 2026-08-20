import type { Interactive } from "@/lib/schema";
import { PlaygroundView } from "./interactive/playground";
import { SimulationView } from "./interactive/simulation";
import { DataExplorerView } from "./interactive/data-explorer";

/** İnteraktif blok dağıtıcısı — tüm host'lar bunu kullanır. */
export function InteractiveRenderer({ interactive }: { interactive: Interactive }) {
  switch (interactive.kind) {
    case "formula-playground":
      return <PlaygroundView playground={interactive} />;
    case "mechanism-simulation":
      return <SimulationView simulation={interactive} />;
    case "dataset-explorer":
      return <DataExplorerView explorer={interactive} />;
  }
}
