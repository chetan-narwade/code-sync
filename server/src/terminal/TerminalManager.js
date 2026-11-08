const os = require("os");
const pty = require("node-pty");

// Event names shared between backend and frontend for all terminal-related
// Socket.IO traffic. Mirrors the pattern used by SocketEvent in types/socket.js.
const TerminalSocketEvent = Object.freeze({
	CREATE: "terminal:create",
	CREATED: "terminal:created",
	INPUT: "terminal:input",
	OUTPUT: "terminal:output",
	RESIZE: "terminal:resize",
	CLOSE: "terminal:close",
	CLOSED: "terminal:closed",
	LIST: "terminal:list",
	LIST_RESULT: "terminal:list_result",
	ERROR: "terminal:error",
});

// Hard limits to keep a single room from exhausting server resources.
const MAX_TERMINALS_PER_ROOM = 5;
const MAX_HISTORY_LENGTH = 200000; // ~200KB of scrollback kept for replay to new clients
const MAX_INPUT_LENGTH = 4096; // per keystroke/paste event
const MIN_COLS = 20;
const MAX_COLS = 400;
const MIN_ROWS = 5;
const MAX_ROWS = 200;

function clamp(value, min, max) {
	return Math.min(Math.max(value, min), max);
}

// Never let the client pick an arbitrary binary to spawn — only the server
// decides which shell to launch, based on the platform it's actually running on.
function getDefaultShell() {
	if (process.platform === "win32") {
		return process.env.COMSPEC || "powershell.exe";
	}
	return process.env.SHELL || "/bin/bash";
}

/**
 * Owns every live node-pty process for every room. One TerminalManager
 * instance is created once when the server boots and shared across all
 * Socket.IO connections.
 *
 * Storage shape: roomId -> Map<terminalId, TerminalSession>
 */
class TerminalManager {
	constructor() {
		this.rooms = new Map();
	}

	_getRoomTerminals(roomId) {
		if (!this.rooms.has(roomId)) {
			this.rooms.set(roomId, new Map());
		}
		return this.rooms.get(roomId);
	}

	hasTerminal(roomId, terminalId) {
		return this.rooms.has(roomId) && this.rooms.get(roomId).has(terminalId);
	}

	/**
	 * Creates a new pty-backed session, or returns the existing one if a
	 * session with this id already exists for the room. This idempotency is
	 * what prevents duplicate shell processes (and therefore duplicate
	 * command execution) when multiple users in the same room both try to
	 * open the same terminal.
	 */
	createTerminal(roomId, terminalId, { cols = 80, rows = 24, cwd } = {}, onData, onExit) {
		const terminals = this._getRoomTerminals(roomId);

		if (terminals.has(terminalId)) {
			return terminals.get(terminalId);
		}

		if (terminals.size >= MAX_TERMINALS_PER_ROOM) {
			throw new Error(`Maximum of ${MAX_TERMINALS_PER_ROOM} terminals per room reached`);
		}

		const safeCols = clamp(Number(cols) || 80, MIN_COLS, MAX_COLS);
		const safeRows = clamp(Number(rows) || 24, MIN_ROWS, MAX_ROWS);

		const ptyProcess = pty.spawn(getDefaultShell(), [], {
			name: "xterm-256color",
			cols: safeCols,
			rows: safeRows,
			cwd: cwd || os.homedir(),
			env: process.env,
		});

		const session = {
			id: terminalId,
			roomId,
			ptyProcess,
			history: "",
			cols: safeCols,
			rows: safeRows,
			createdAt: Date.now(),
		};

		ptyProcess.onData((data) => {
			session.history += data;
			if (session.history.length > MAX_HISTORY_LENGTH) {
				session.history = session.history.slice(session.history.length - MAX_HISTORY_LENGTH);
			}
			onData?.(data);
		});

		ptyProcess.onExit(({ exitCode, signal }) => {
			terminals.delete(terminalId);
			onExit?.({ exitCode, signal });
		});

		terminals.set(terminalId, session);
		return session;
	}

	writeToTerminal(roomId, terminalId, data) {
		const session = this.rooms.get(roomId)?.get(terminalId);
		if (!session) return false;
		if (typeof data !== "string" || data.length === 0) return false;

		// Truncate rather than reject, so a slightly-too-long paste still
		// mostly works instead of silently doing nothing.
		const safeData = data.slice(0, MAX_INPUT_LENGTH);
		session.ptyProcess.write(safeData);
		return true;
	}

	resizeTerminal(roomId, terminalId, cols, rows) {
		const session = this.rooms.get(roomId)?.get(terminalId);
		if (!session) return false;

		const safeCols = clamp(Number(cols) || session.cols, MIN_COLS, MAX_COLS);
		const safeRows = clamp(Number(rows) || session.rows, MIN_ROWS, MAX_ROWS);

		session.ptyProcess.resize(safeCols, safeRows);
		session.cols = safeCols;
		session.rows = safeRows;
		return true;
	}

	closeTerminal(roomId, terminalId) {
		const terminals = this.rooms.get(roomId);
		const session = terminals?.get(terminalId);
		if (!session) return false;

		try {
			session.ptyProcess.kill();
		} catch (err) {
			console.error(`Failed to kill terminal ${terminalId} in room ${roomId}:`, err);
		}

		terminals.delete(terminalId);
		if (terminals.size === 0) {
			this.rooms.delete(roomId);
		}
		return true;
	}

	// Called when the last user leaves a room, so no shell processes are
	// left running for a room nobody is connected to anymore.
	killRoomTerminals(roomId) {
		const terminals = this.rooms.get(roomId);
		if (!terminals) return;

		for (const [terminalId, session] of terminals) {
			try {
				session.ptyProcess.kill();
			} catch (err) {
				console.error(`Failed to kill terminal ${terminalId} in room ${roomId}:`, err);
			}
		}
		this.rooms.delete(roomId);
	}

	getActiveRoomIds() {
		return Array.from(this.rooms.keys());
	}

	getRoomSessionsInfo(roomId) {
		const terminals = this.rooms.get(roomId);
		if (!terminals) return [];
		return Array.from(terminals.values()).map((session) => ({
			id: session.id,
			cols: session.cols,
			rows: session.rows,
			createdAt: session.createdAt,
		}));
	}
}

module.exports = { TerminalManager, TerminalSocketEvent, MAX_TERMINALS_PER_ROOM };