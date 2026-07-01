module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (req.headers["x-api-key"] !== process.env.API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { amount, customerName, customerEmail, paymentMethod } = req.body;
  if (!amount || Number(amount) <= 0) {
    return res.status(400).json({ error: "Invalid amount" });
  }
  if (paymentMethod !== "gcash" && paymentMethod !== "paymaya") {
    return res.status(400).json({ error: "Invalid payment method" });
  }

  const amountInCentavos = Math.round(Number(amount) * 100);
  const secretKey = process.env.PAYMONGO_SECRET_KEY;
  const encoded = Buffer.from(`${secretKey}:`).toString("base64");
  const authHeaders = {
    "Content-Type": "application/json",
    Authorization: `Basic ${encoded}`,
  };

  try {
    // 1. Create the Payment Intent
    const intentRes = await fetch("https://api.paymongo.com/v1/payment_intents", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        data: {
          attributes: {
            amount: amountInCentavos,
            currency: "PHP",
            payment_method_allowed: ["gcash", "paymaya"],
            description: "RentWise Online Rent Payment",
          },
        },
      }),
    });
    if (!intentRes.ok) {
      const errBody = await intentRes.json();
      console.error("PayMongo create-intent error:", errBody);
      return res.status(500).json({ error: "Failed to create payment intent" });
    }
    const intent = await intentRes.json();
    const paymentIntentId = intent.data.id;

    // 2. Create the Payment Method
    const methodRes = await fetch("https://api.paymongo.com/v1/payment_methods", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        data: {
          attributes: {
            type: paymentMethod,
            billing: {
              name: customerName || "",
              email: customerEmail || "",
            },
          },
        },
      }),
    });
    if (!methodRes.ok) {
      const errBody = await methodRes.json();
      console.error("PayMongo create-method error:", errBody);
      return res.status(500).json({ error: "Failed to create payment method" });
    }
    const method = await methodRes.json();

    // 3. Attach the Payment Method to the Payment Intent
    const returnUrl = `rentwise://payment-success?amount=${amountInCentavos}&pi=${paymentIntentId}`;
    const attachRes = await fetch(
      `https://api.paymongo.com/v1/payment_intents/${paymentIntentId}/attach`,
      {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          data: {
            attributes: {
              payment_method: method.data.id,
              return_url: returnUrl,
            },
          },
        }),
      },
    );
    if (!attachRes.ok) {
      const errBody = await attachRes.json();
      console.error("PayMongo attach error:", errBody);
      return res.status(500).json({ error: "Failed to start payment authorization" });
    }
    const attached = await attachRes.json();
    const redirectUrl = attached.data.attributes.next_action?.redirect?.url;
    if (!redirectUrl) {
      console.error("PayMongo attach: no redirect URL in response", attached);
      return res.status(500).json({ error: "Payment authorization did not return a redirect URL" });
    }

    return res.status(200).json({ redirectUrl, paymentIntentId });
  } catch (err) {
    console.error("PayMongo payment-intent flow error:", err);
    return res.status(500).json({ error: "Failed to start payment" });
  }
};
