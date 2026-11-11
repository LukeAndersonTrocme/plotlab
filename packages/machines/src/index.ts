import generic from "./profiles/generic.json";
import type { MachineProfile } from "./profile.ts";

export * from "./profile.ts";
export * from "./estimate.ts";

export const builtinMachines: Record<string, MachineProfile> = {
  generic: generic as MachineProfile,
};

export function getMachine(id: string): MachineProfile {
  const m = builtinMachines[id];
  if (!m) throw new Error(`unknown machine profile "${id}" (known: ${Object.keys(builtinMachines).join(", ")})`);
  return m;
}
