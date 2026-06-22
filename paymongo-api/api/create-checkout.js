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

  const { amount, customerName, customerEmail } = req.body;
  if (!amount || Number(amount) <= 0) {
    return res.status(400).json({ error: "Invalid amount" });
  }

  const amountInCentavos = Math.round(Number(amount) * 100);
  const secretKey = process.env.PAYMONGO_SECRET_KEY;
  const encoded = Buffer.from(`${secretKey}:`).toString("base64");

  const attributes = {
    line_items: [
      {
        currency: "PHP",
        amount: amountInCentavos,
        name: "RentWise Online Rent Payment",
        quantity: 1,
      },
    ],
    payment_method_types: ["gcash", "paymaya"],
    description: "RentWise Online Rent Payment",
    send_email_receipt: false,
    success_url: `rentwise://payment-success?amount=${amountInCentavos}`,
    cancel_url: "rentwise://payment-cancel",
  };

  if (customerName || customerEmail) {
    attributes.customer_info = {
      name: customerName || "",
      email: customerEmail || "",
    };
  }

  const pmRes = await fetch(
    "https://api.paymongo.com/v1/checkout_sessions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${encoded}`,
      },
      body: JSON.stringify({ data: { attributes } }),
    }
  );

  if (!pmRes.ok) {
    const errBody = await pmRes.json();
    console.error("PayMongo error:", errBody);
    return res.status(500).json({ error: "Failed to create checkout session" });
  }

  const parsed = await pmRes.json();
  return res.status(200).json({
    checkoutSessionId: parsed.data.id,
    checkoutUrl: parsed.data.attributes.checkout_url,
  });
};
