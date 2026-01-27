const express = require("express");
const crypto = require("crypto");
const router = express.Router();

require("dotenv").config();

// ============================
// 🔵 GENERAR LINK / QR IZIPAY
// ============================
router.post("/generar-yape", async (req, res) => {
  try {
    const fakePayload = "SIMULATED_PAYLOAD_BASE64";
    const fakeSignature = "SIMULATED_SIGNATURE_SHA256";

    res.json({
      ok: true,
      payload: fakePayload,
      signature: fakeSignature,
      message: "Modo SIMULACIÓN activado. Aún no tienes credenciales IZIPAY"
    });

  } catch (error) {
    res.status(500).json({ error: "Error en modo simulación" });
  }
});


module.exports = router;
