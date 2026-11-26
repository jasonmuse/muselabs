// Every request to muselabs.app/feed/api/* lands here; the API itself is in feed-api/ (with its tests).
import { handle } from '../../../feed-api/index.js';

// `later` lets the API finish small jobs (the ping and the note after a sign-in) once its answer has gone out.
export const onRequest = (context) => handle(context.request, context.env, { later: (work) => context.waitUntil(work) });
