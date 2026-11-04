// The decision-model interface, using the Jev / Ollama `/v1/systemone` wire format directly.
// The rest of the app talks only to `DecisionProvider`; nothing outside `providers/` is provider-specific.

import type { InstalledModel, ModelProfile, ProviderStatus } from '../../shared/types';
import type { AppConfig } from '../config';
import type { Catalog } from './catalog';

// ---- Wire format -----------------------------------------------------------------------------

/** A string, or a JSON object / array for structured input. */
export type SystemOneState = string | Record<string, unknown> | unknown[];

export interface ChoiceQuestion {
  type: 'choice';
  instructions: string;
  /** Option key -> description (or null to let the key describe itself). 2 to 26 options. */
  criteria: Record<string, string | null>;
}

export interface NoulQuestion {
  type: 'noul';
  instructions: string;
  criteria?: { true?: string; false?: string };
}

export interface ScoreQuestion {
  type: 'score';
  instructions: string;
  /** Level descriptions, lowest first. Levels are numbered from 0. */
  criteria: string[];
}

export type Question = ChoiceQuestion | NoulQuestion | ScoreQuestion;
/** 1 to 64 named questions per request. */
export type Questions = Record<string, Question>;

export interface ChoiceAnswer {
  type: 'choice';
  choice: string;
  probabilities: Record<string, number>;
  /** How concentrated the probabilities are (0..1). NOT the chance the answer is right. */
  confidence: number;
}

export interface NoulAnswer {
  type: 'noul';
  /** Probability that the answer is true. */
  noul: number;
}

export interface ScoreAnswer {
  type: 'score';
  /** Probability-weighted level (a float from 0 to levels - 1). */
  score: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
  confidence: number;
}

export type Answer = ChoiceAnswer | NoulAnswer | ScoreAnswer;
export type Answers = Record<string, Answer>;

export interface SystemOneRequest {
  model: string;
  state: SystemOneState;
  questions: Questions;
  keep_alive?: string | number;
}

export interface SystemOneResponse {
  model: string;
  answers: Answers;
  usage?: { input_tokens: number; output_tokens: number };
}

export const LIMITS = {
  minQuestions: 1,
  maxQuestions: 64,
  minOptions: 2,
  maxOptions: 26,
  /** Request bodies (text and schema) may be up to 64 KiB. */
  maxBodyBytes: 64 * 1024,
} as const;

// ---- App-facing interface ----------------------------------------------------------------------

export interface DecisionModel {
  readonly providerId: string;
  readonly model: string;
  /** Ask 1-64 typed questions about one state. Resolves with validated answers in the wire format. */
  ask(state: SystemOneState, questions: Questions, opts?: { signal?: AbortSignal }): Promise<SystemOneResponse>;
}

export interface DecisionProvider extends DecisionModel {
  /** Startup / health checks. Cached briefly unless `force`. */
  status(force?: boolean): Promise<ProviderStatus>;
  /** Switch models live, without a restart. Resolves with the new model's status. */
  setModel(model: string): Promise<ProviderStatus>;
  /** Models available to this provider, for the settings screen. */
  listModels(): Promise<InstalledModel[]>;
  /** The catalog profile (or a derived one) for the current model: budgets, languages, etc. */
  profile(): ModelProfile;
}

export interface ProviderContext {
  config: AppConfig;
  catalog: Catalog;
  log: (msg: string) => void;
}

/** What each file in `providers/` default-exports. */
export interface ProviderFactory {
  id: string;
  create(ctx: ProviderContext, model: string): DecisionProvider;
}

export type DecisionErrorCode =
  | 'offline'
  | 'outdated'
  | 'endpoint_missing'
  | 'model_missing'
  | 'cloud_model'
  | 'not_decision_model'
  | 'remote_host'
  | 'context_exceeded'
  | 'too_large'
  | 'timeout'
  | 'out_of_memory'
  | 'bad_response'
  | 'http_error';

export class DecisionError extends Error {
  constructor(
    public readonly code: DecisionErrorCode,
    message: string,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'DecisionError';
  }
}
