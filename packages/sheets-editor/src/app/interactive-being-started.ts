/** Which interactive sheet this tab was starting when it last froze, kept in session storage. */
export interface InteractiveBeingStarted {
  /** Whether the tab froze last time while starting the interactive of this node, and has not started it again since. */
  wasLeftStarting(nodeId: string): boolean;
  starts(nodeId: string): void;
  hasNotFrozen(): void;
}
export function interactiveBeingStarted(storage: () => Storage): InteractiveBeingStarted {
  let withStorage = <T>(use: (store: Storage) => T): T | null => {
    try {
      return use(storage());
    } catch {
      return null;
    }
  };
  let leftStarting = withStorage((store) => store.getItem('sheets:interactive-being-started'));
  let hasStartedItAgain = false;
  return {
    wasLeftStarting: (nodeId) => !hasStartedItAgain && leftStarting === nodeId,
    starts(nodeId) {
      hasStartedItAgain ||= nodeId === leftStarting;
      withStorage((store) => store.setItem('sheets:interactive-being-started', nodeId));
    },
    hasNotFrozen: () => void withStorage((store) => store.removeItem('sheets:interactive-being-started')),
  };
}
