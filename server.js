const express = require("express");
const cors = require("cors");

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "mundial-2026-api",
    time: new Date().toISOString()
  });
});

app.use((_req, res) => {
  res.status(404).json({
    ok: false,
    error: "Not Found"
  });
});

app.listen(port, () => {
  console.log(`mundial-2026-api listening on port ${port}`);
});
