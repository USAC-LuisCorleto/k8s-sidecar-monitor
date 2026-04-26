export interface HealthResponse {
  status: string;
  service: string;
  timestamp: string;
}

export interface ProcessResponse {
  message: string;
  processor: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

export interface ErrorResponse {
  error: string;
  timestamp: string;
}
