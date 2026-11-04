// Plain-HTTP helpers for any server that speaks the `/v1/systemone` wire format
// (Ollama, llama.cpp's server, Jev's own API, ...). Providers build on these.

import { validateResponse, type ValidatedResponse } from './parse';
import { DecisionError, LIMITS, type Questions, type SystemOneRequest } from './types';

export interface HttpResult {
  status: number;
  text: string;
  json: unknown;
}

export async function httpJson(
  url: string,
  init: { method?: 'GET' | 'POST'; body?: unknown; timeoutMs: number; headers?: Record<string, string>; signal?: AbortSignal },
): Promise<HttpResult> {
  const timeout = AbortSignal.timeout(init.timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: { 'Content-Type': 'application/json', ...init.headers },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal,
    });
  } catch (err) {
    if (init.signal?.aborted) throw new DecisionError('aborted', 'The request was cancelled.');
    if (timeout.aborted) throw new DecisionError('timeout', `No answer from ${new URL(url).host} within ${Math.round(init.timeoutMs / 1000)} s.`);
    throw new DecisionError('offline', `Could not reach ${new URL(url).host}: ${(err as Error).message}`);
  }
  let text: string;
  try {
    text = await res.text();
  } catch (err) {
    if (init.signal?.aborted) throw new DecisionError('aborted', 'The request was cancelled.');
    if (timeout.aborted) throw new DecisionError('timeout', `No answer from ${new URL(url).host} within ${Math.round(init.timeoutMs / 1000)} s.`);
    throw new DecisionError('offline', `Connection to ${new URL(url).host} dropped: ${(err as Error).message}`);
  }
  let json: unknown = undefined;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { status: res.status, text, json };
}

export function errorMessage(r: HttpResult): string {
  const j = r.json as { error?: unknown } | undefined;
  return typeof j?.error === 'string' ? j.error : r.text.slice(0, 300);
}

/** Size of the request's text and schema, which must stay within 64 KiB. */
export function requestBytes(body: SystemOneRequest): number {
  return Buffer.byteLength(JSON.stringify({ state: body.state, questions: body.questions }), 'utf8');
}

export function checkRequest(body: SystemOneRequest): void {
  const n = Object.keys(body.questions).length;
  if (n < LIMITS.minQuestions || n > LIMITS.maxQuestions) {
    throw new DecisionError('bad_response', `A request needs 1 to 64 questions (got ${n}).`);
  }
  for (const [name, q] of Object.entries(body.questions)) {
    const options = q.type === 'choice' ? Object.keys(q.criteria).length : q.type === 'score' ? q.criteria.length : 2;
    if (options < LIMITS.minOptions || options > LIMITS.maxOptions) {
      throw new DecisionError('bad_response', `Question "${name}" needs 2 to 26 options (got ${options}).`);
    }
  }
  if (requestBytes(body) > LIMITS.maxBodyBytes) {
    throw new DecisionError('too_large', 'This entry is too long to send in one request (over 64 KiB).');
  }
}

/** Map an HTTP error from a `/v1/systemone` endpoint to a DecisionError. */
export function mapSystemOneError(r: HttpResult, model: string): DecisionError {
  const msg = errorMessage(r);
  if (r.status === 404) {
    // A JSON error naming the model means the model is missing; a bare 404 means the endpoint itself is missing.
    if (r.json && /model|not found/i.test(msg) && !/page not found/i.test(msg)) {
      return new DecisionError('model_missing', `The model "${model}" isn't downloaded yet.`, 404);
    }
    return new DecisionError('endpoint_missing', 'This server does not support decision models (/v1/systemone).', 404);
  }
  if (r.status === 401 || r.status === 402) {
    return new DecisionError('cloud_model', `"${model}" needs a cloud account. Mote only uses models that run on your computer.`, r.status);
  }
  if (r.status === 413) return new DecisionError('too_large', 'This entry is too long to send in one request.', 413);
  if (r.status === 400 && /context|exceed|too long|token/i.test(msg)) {
    return new DecisionError('context_exceeded', `This entry is longer than "${model}" can read at once.`, 400);
  }
  if (r.status === 400 && /does not support|not a decision|unsupported model|capabilit/i.test(msg)) {
    return new DecisionError('not_decision_model', `"${model}" is not a decision model.`, 400);
  }
  if (r.status >= 500 && /killed|out of memory|oom|insufficient memory|requires more system memory/i.test(msg)) {
    return new DecisionError('out_of_memory', `"${model}" stopped because the computer ran out of memory.`, r.status);
  }
  return new DecisionError('http_error', `The decision server answered ${r.status}: ${msg}`, r.status);
}

/** POST a request to `{baseUrl}/v1/systemone` and validate the answers. */
export async function askSystemOne(
  baseUrl: string,
  body: SystemOneRequest,
  questions: Questions,
  opts: { timeoutMs: number; headers?: Record<string, string>; signal?: AbortSignal },
): Promise<ValidatedResponse> {
  checkRequest(body);
  const r = await httpJson(`${baseUrl}/v1/systemone`, { method: 'POST', body, ...opts });
  if (r.status < 200 || r.status >= 300) throw mapSystemOneError(r, body.model);
  if (r.json === undefined) throw new DecisionError('bad_response', 'The decision server returned something that is not JSON.');
  return validateResponse(questions, r.json, body.model);
}
