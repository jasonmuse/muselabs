// Every request to muselabs.app/feed/api/* lands here; the API itself is in feed-api/ (with its tests).
import { handle } from '../../../feed-api/index.js';

export const onRequest = (context) => handle(context.request, context.env);
