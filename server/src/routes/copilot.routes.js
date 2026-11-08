const express = require("express");
const { generateCode } = require("../controllers/copilot.controller");

const router = express.Router();

// POST /api/copilot/generate
router.post("/generate", generateCode);

module.exports = router;