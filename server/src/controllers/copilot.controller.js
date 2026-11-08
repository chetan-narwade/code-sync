const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const SYSTEM_INSTRUCTION = `
You are an expert software engineer acting as a coding copilot.
Given a user's request, respond with clean, correct, well-formatted code.
Always wrap code in a fenced code block with the appropriate language tag.
Keep explanations brief — the user mainly wants working code.
`;

const generateCode = async (req, res) => {
    try {
        const { prompt } = req.body;

        if (!prompt || !prompt.trim()) {
            return res.status(400).json({
                success: false,
                message: "Prompt is required",
            });
        }

        const model = genAI.getGenerativeModel({
            model: "gemini-3.6-flash",
            systemInstruction: SYSTEM_INSTRUCTION,
        });

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        if (!text) {
            return res.status(502).json({
                success: false,
                message: "No response received from Gemini",
            });
        }

        return res.status(200).json({
            success: true,
            result: text,
        });

    } catch (error) {
        console.error("Gemini generateCode error:", error);

        return res.status(500).json({
            success: false,
            message: error.message || "Failed to generate code",
        });
    }
};

module.exports = {
    generateCode,
};