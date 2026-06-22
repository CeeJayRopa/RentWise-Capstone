import { Request, Response } from 'express';
import axios from 'axios';

/**
 * POST /api/payments/checkout
 * Creates a Paymongo payment link for GCash or Maya.
 * Replace the mock response with a live Paymongo API call when ready.
 */
export const checkout = async (req: Request, res: Response): Promise<void> => {
  try {
    const { amount, description, currency = 'PHP' } = req.body as {
      amount: number;
      description: string;
      currency?: string;
    };

    if (!amount || !description) {
      res.status(400).json({ success: false, message: 'amount and description are required.' });
      return;
    }

    // TODO: Replace mock block with live Paymongo call:
    // const response = await axios.post(
    //   'https://api.paymongo.com/v1/links',
    //   { data: { attributes: { amount: amount * 100, description, currency } } },
    //   {
    //     headers: {
    //       Authorization: `Basic ${Buffer.from(process.env.PAYMONGO_SECRET_KEY + ':').toString('base64')}`,
    //       'Content-Type': 'application/json',
    //     },
    //   }
    // );
    // res.status(201).json({ success: true, data: response.data });

    // Mock response
    res.status(201).json({
      success: true,
      message: 'Mock checkout link created.',
      data: {
        checkout_url: 'https://mock.paymongo.com/pay/mock-link-id',
        amount,
        description,
        currency,
      },
    });
  } catch (error) {
    if (axios.isAxiosError(error)) {
      res.status(error.response?.status ?? 502).json({
        success: false,
        message: error.response?.data ?? 'Payment gateway error.',
      });
      return;
    }
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};
