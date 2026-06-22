import { Router } from 'express';
import { checkout } from '../controllers/paymentController';

const router = Router();

// POST /api/payments/checkout
router.post('/checkout', checkout);

export default router;
