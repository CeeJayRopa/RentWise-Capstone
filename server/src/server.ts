import 'dotenv/config';
import express, { Application, Request, Response } from 'express';
import cors from 'cors';

import paymentsRouter from './routes/payments';
import notifyRouter from './routes/notify';

const app: Application = express();
const PORT = process.env.PORT ?? 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'RentWise API' });
});

// Routes
app.use('/api/payments', paymentsRouter);
app.use('/api/notify', notifyRouter);

app.listen(PORT, () => {
  console.log(`RentWise API running on http://localhost:${PORT}`);
});

export default app;
