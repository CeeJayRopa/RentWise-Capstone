import { Request, Response } from 'express';
import axios from 'axios';

const SEMAPHORE_URL = 'https://api.semaphore.co/api/v4/messages';

/**
 * POST /api/notify/send-sms
 * Sends an SMS notification via the Semaphore API gateway.
 * Replace the mock response with a live Semaphore call when ready.
 */
export const sendSms = async (req: Request, res: Response): Promise<void> => {
  try {
    const { number, message } = req.body as {
      number: string;
      message: string;
    };

    if (!number || !message) {
      res.status(400).json({ success: false, message: 'number and message are required.' });
      return;
    }

    // TODO: Replace mock block with live Semaphore call:
    // const response = await axios.post(SEMAPHORE_URL, {
    //   apikey: process.env.SEMAPHORE_API_KEY,
    //   number,
    //   message,
    //   sendername: process.env.SEMAPHORE_SENDER_NAME ?? 'RentWise',
    // });
    // res.status(200).json({ success: true, data: response.data });

    // Mock response
    res.status(200).json({
      success: true,
      message: 'Mock SMS queued for delivery.',
      data: {
        recipient: number,
        body: message,
        sender: process.env.SEMAPHORE_SENDER_NAME ?? 'RentWise',
        status: 'Queued',
      },
    });
  } catch (error) {
    if (axios.isAxiosError(error)) {
      res.status(error.response?.status ?? 502).json({
        success: false,
        message: error.response?.data ?? 'SMS gateway error.',
      });
      return;
    }
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};
