const express = require("express");

// Small read-only REST surface for monitoring/debugging active terminal
// sessions. All real-time terminal traffic (input/output/resize) goes over
// Socket.IO — these routes exist only for visibility, e.g. an admin/status
// page, health checks, or local debugging.
function createTerminalRoutes(terminalManager) {
	const router = express.Router();

	router.get("/rooms", (req, res) => {
		res.json({ rooms: terminalManager.getActiveRoomIds() });
	});

	router.get("/rooms/:roomId/sessions", (req, res) => {
		const { roomId } = req.params;
		res.json({ sessions: terminalManager.getRoomSessionsInfo(roomId) });
	});

	return router;
}

module.exports = { createTerminalRoutes };