import { Router, Request, Response } from 'express';
import { ApiDataResponse, ErrorResponse, HealthResponse, ServiceBResponse } from './types';

const router = Router();

const SERVICE_B_URL = process.env.SERVICE_B_URL || 'http://service-b:8080';

router.get('/health', (_req: Request, res: Response<HealthResponse>) => {
  res.json({
    status: 'ok',
    service: 'service-a',
    timestamp: new Date().toISOString(),
  });
});

router.get('/api/data', async (_req: Request, res: Response<ApiDataResponse | ErrorResponse>) => {
  try {
    const response = await fetch(`${SERVICE_B_URL}/internal/process`);

    if (!response.ok) {
      throw new Error(`Servicio-B respondio con status ${response.status}`);
    }

    const dataFromB = (await response.json()) as ServiceBResponse;

    const result: ApiDataResponse = {
      message: 'Datos obtenidos exitosamente desde el Gateway',
      source: 'service-a',
      dataFromServiceB: dataFromB,
      timestamp: new Date().toISOString(),
    };

    res.json(result);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Error desconocido';

    const errorResponse: ErrorResponse = {
      error: `Fallo al contactar Servicio-B: ${errMsg}`,
      timestamp: new Date().toISOString(),
    };

    res.status(500).json(errorResponse);
  }
});

export default router;
