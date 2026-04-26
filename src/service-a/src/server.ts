import express, { Application, Request, Response, NextFunction } from 'express';
import pino from 'pino';
import routes from './routes';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label: string) => ({ level: label }),
  },
});

const app: Application = express();
const PORT = process.env.PORT || '8080';

app.use((req: Request, _res: Response, next: NextFunction) => {
  logger.info({
    method: req.method,
    url: req.url,
    headers: req.headers,
    timestamp: new Date().toISOString(),
  }, 'Peticion recibida');
  next();
});

app.use(express.json());
app.use('/', routes);

app.use((_req: Request, res: Response) => {
  logger.warn({ url: _req.url }, 'Ruta no encontrada');
  res.status(404).json({
    error: 'Ruta no encontrada',
    timestamp: new Date().toISOString(),
  });
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err: err.message, stack: err.stack }, 'Error interno del servidor');
  res.status(500).json({
    error: 'Error interno del servidor',
    timestamp: new Date().toISOString(),
  });
});

export function startServer(): void {
  app.listen(PORT, () => {
    logger.info({ port: PORT, service: 'service-a' }, 'Servicio-A iniciado correctamente');
  });
}

export default app;
