import { Router, Request, Response } from 'express';
import { HealthResponse, ProcessResponse, ErrorResponse } from './types';

const router = Router();

router.get('/health', (_req: Request, res: Response<HealthResponse>) => {
  res.json({
    status: 'ok',
    service: 'service-b',
    timestamp: new Date().toISOString(),
  });
});

router.get('/internal/process', (_req: Request, res: Response<ProcessResponse | ErrorResponse>) => {
  try {
    const result: ProcessResponse = {
      message: 'Procesamiento interno completado',
      processor: 'service-b',
      payload: {
        processedItems: 3,
        items: ['item-alpha', 'item-beta', 'item-gamma'],
        checksum: 'abc123',
      },
      timestamp: new Date().toISOString(),
    };

    res.json(result);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Error desconocido';

    const errorResponse: ErrorResponse = {
      error: errMsg,
      timestamp: new Date().toISOString(),
    };

    res.status(500).json(errorResponse);
  }
});

export default router;
