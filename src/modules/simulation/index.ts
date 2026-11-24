// Public API of the simulation module (Phase 7): the scenario runner and its screen.
// It acts only through the other modules' public services, as the sites' own users.
export * from "./domain/config";
export * from "./domain/random";
export * from "./domain/templates";
export { runSimulation, checkSimulationInvariants, type SimulationReport, type SimulationInvariants } from "./services/runner";
export { getSimulationStatus, type SimulationRunRow } from "./queries/runs";
export { startSimulationJob, stopSimulationJob, getSimulationJob, type SimulationJob } from "./services/jobs";
