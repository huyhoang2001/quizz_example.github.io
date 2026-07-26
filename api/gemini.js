const GOOGLE_GEMINI_BASE =
  "https://generativelanguage.googleapis.com";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    return response.status(405).json({ error: "Method not allowed" });
  }

  const configuredSecret = String(
    process.env.GEMINI_RELAY_SECRET || "",
  );
  const receivedSecret = String(
    request.headers["x-relay-secret"] || "",
  );

  if (configuredSecret && receivedSecret !== configuredSecret) {
    return response.status(401).json({ error: "Unauthorized" });
  }

  const pathValue = Array.isArray(request.query.path)
    ? request.query.path.join("/")
    : String(request.query.path || "");

  if (
    !/^v1beta\/models\/[a-zA-Z0-9._-]+:generateContent$/.test(
      pathValue,
    )
  ) {
    return response.status(404).json({ error: "Route not allowed" });
  }

  const apiKey = String(request.headers["x-goog-api-key"] || "");

  if (!apiKey) {
    return response.status(400).json({ error: "Missing API key" });
  }

  try {
    const upstream = await fetch(
      `${GOOGLE_GEMINI_BASE}/${pathValue}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(request.body || {}),
      },
    );

    const payload = await upstream.text();

    response.status(upstream.status);
    response.setHeader(
      "Content-Type",
      upstream.headers.get("content-type") ||
        "application/json; charset=utf-8",
    );
    response.setHeader("Cache-Control", "no-store");

    return response.send(payload);
  } catch (error) {
    return response.status(502).json({
      error:
        error instanceof Error
          ? error.message
          : "Gemini upstream request failed",
    });
  }
}
