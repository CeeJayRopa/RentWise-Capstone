import { Router } from 'express';
import { sendSms } from '../controllers/smsController';

const router = Router();

// POST /api/notify/send-sms
router.post('/send-sms', sendSms);

export default router;
