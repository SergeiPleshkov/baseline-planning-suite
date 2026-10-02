/** First line of an error message: federation errors append long troubleshooting text. */
export function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split('\n', 1)[0] ?? message;
}
