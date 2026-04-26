export interface HealthResponse {
  status: string;
  service: string;
  timestamp: string;
}

export interface ApiDataResponse {
  message: string;
  source: string;
  dataFromServiceB: unknown;
  timestamp: string;
}

export interface ServiceBResponse {
  message: string;
  processor: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

export interface ErrorResponse {
  error: string;
  timestamp: string;
}
