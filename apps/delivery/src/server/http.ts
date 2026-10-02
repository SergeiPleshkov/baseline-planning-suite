import type { Context, MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { streamSSE } from 'hono/streaming';

export type ErrorStatus = 400 | 404 | 409 | 413 | 415 | 422 | 500;

export const problem = (context: Context, status: ErrorStatus, code: string, message: string) =>
  context.json({ error: { code, message } }, status);

/** The first problem of a zod result, worded for the caller. */
export const firstIssue = (issues: readonly { readonly message: string }[]): string =>
  issues[0]?.message ?? 'Invalid request.';

export const readJson = (context: Context): Promise<unknown> =>
  context.req.json().catch(() => undefined);

/** Read from the URL: an id that is blank cannot name anything, so it is "not found". */
export const idParam = (context: Context, name: string): string | undefined => {
  const value = context.req.param(name);
  return value === undefined || value.trim() === '' ? undefined : value;
};

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

/**
 * Commands are JSON. A `text/plain` POST is a "simple" cross-origin request that any web page the
 * user visits could make without a preflight, so anything but JSON is refused before it is read.
 */
export const requireJson: MiddlewareHandler = async (context, next) => {
  const type = context.req.header('content-type') ?? '';
  if (BODY_METHODS.has(context.req.method) && !/^application\/json\s*(;|$)/i.test(type)) {
    return problem(context, 415, 'unsupported-media-type', 'Send the request as application/json.');
  }
  return next();
};

export const limitBody: MiddlewareHandler = bodyLimit({
  maxSize: 64 * 1024,
  onError: (context) => problem(context, 413, 'too-large', 'The request is too large.'),
});

/**
 * Server-sent events: one `event:` per message, a comment first so the client knows the stream is
 * open, and a comment every `heartbeatMs` so idle proxies do not cut it.
 */
type Announcement = { readonly type: string };

export function eventStream(
  context: Context,
  subscribe: (listener: (event: Announcement) => void) => () => void,
  heartbeatMs: number,
) {
  return streamSSE(context, async (stream) => {
    const unsubscribe = subscribe((event) => {
      void stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
    });
    stream.onAbort(() => {
      unsubscribe();
    });
    await stream.write(': open\n\n');
    for (;;) {
      await stream.sleep(heartbeatMs);
      if (stream.aborted) break;
      await stream.write(': keep-alive\n\n');
    }
  });
}
