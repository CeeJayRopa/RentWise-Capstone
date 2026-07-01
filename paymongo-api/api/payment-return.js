// PayMongo's Payment Intents `attach` endpoint requires a real http(s)
// return_url (unlike Checkout Sessions, which accepted our rentwise://
// custom scheme directly), and only supports ONE return_url for both
// success and cancellation — there's no separate cancel_url like Checkout
// Sessions had. This endpoint is that http(s) return_url: it checks the
// intent's actual status, then 302-redirects to the appropriate rentwise://
// deep link, which the app's existing WebView interception already handles.
module.exports = async function handler(req, res) {
  const { amount, pi } = req.query;

  const redirectTo = (url) => {
    res.writeHead(302, { Location: url });
    res.end();
  };

  if (!pi) {
    return redirectTo("rentwise://payment-cancel");
  }

  try {
    const secretKey = process.env.PAYMONGO_SECRET_KEY;
    const encoded = Buffer.from(`${secretKey}:`).toString("base64");

    const intentRes = await fetch(
      `https://api.paymongo.com/v1/payment_intents/${pi}`,
      {
        headers: { Authorization: `Basic ${encoded}` },
      },
    );

    if (!intentRes.ok) {
      // Can't confirm status — let the app fall back to its normal
      // pending-then-admin-review flow rather than silently dropping it.
      return redirectTo(`rentwise://payment-success?amount=${amount}&pi=${pi}`);
    }

    const intent = await intentRes.json();
    const status = intent.data.attributes.status;

    if (status === "succeeded" || status === "processing") {
      return redirectTo(`rentwise://payment-success?amount=${amount}&pi=${pi}`);
    }

    return redirectTo("rentwise://payment-cancel");
  } catch (err) {
    console.error("payment-return status check error:", err);
    return redirectTo(`rentwise://payment-success?amount=${amount}&pi=${pi}`);
  }
};
