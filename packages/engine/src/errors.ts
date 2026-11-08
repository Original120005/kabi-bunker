/** Rule violation with a message that is shown to the player as is. */
export class GameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GameError";
  }
}

export function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new GameError(message);
}
