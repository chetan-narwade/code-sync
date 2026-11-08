const path = require("path");
const dotenv = require("dotenv");
dotenv.config({ path: path.join(__dirname, "../.env") });

const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const { SocketEvent } = require("./types/socket");
const { USER_CONNECTION_STATUS } = require("./types/user");
const { TerminalManager, TerminalSocketEvent } = require("./terminal/TerminalManager");
const { createTerminalRoutes } = require("./terminal/terminalRoutes");
const copilotRoutes = require("./routes/copilot.routes");

const app = express();

app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, "public"))); // Serve static files

console.log(
	"Gemini key loaded:",
	process.env.GEMINI_API_KEY
		? "YES (" + process.env.GEMINI_API_KEY.slice(0, 6) + "...)"
		: "NO — undefined",
);

const server = http.createServer(app);

const io = new Server(server, {
	cors: {
		origin: "*",
	},
	maxHttpBufferSize: 1e8,
	pingTimeout: 60000,
});

// One TerminalManager for the whole server process, shared by every room.
const terminalManager = new TerminalManager();
app.use("/api/terminal", createTerminalRoutes(terminalManager));
app.use("/api/copilot", copilotRoutes);

let userSocketMap = [];

function getUsersInRoom(roomId) {
	return userSocketMap.filter((user) => user.roomId == roomId);
}

function getRoomId(socketId) {
	const roomId = userSocketMap.find((user) => user.socketId === socketId)?.roomId;
	if (!roomId) {
		console.error("Room ID is undefined for socket ID:", socketId);
		return null;
	}
	return roomId;
}

function getUserBySocketId(socketId) {
	const user = userSocketMap.find((user) => user.socketId === socketId);
	if (!user) {
		console.error("User not found for socket ID:", socketId);
		return null;
	}
	return user;
}

function socketIsInRoom(socket, roomId) {
	return typeof roomId === "string" && roomId.length > 0 && socket.rooms.has(roomId);
}

io.on("connection", (socket) => {
	socket.on(SocketEvent.JOIN_REQUEST, ({ roomId, username }) => {
		const isUsernameExist = getUsersInRoom(roomId).filter((u) => u.username === username);
		if (isUsernameExist.length > 0) {
			io.to(socket.id).emit(SocketEvent.USERNAME_EXISTS);
			return;
		}

		const user = {
			username,
			roomId,
			status: USER_CONNECTION_STATUS.ONLINE,
			cursorPosition: 0,
			typing: false,
			socketId: socket.id,
			currentFile: null,
		};

		userSocketMap.push(user);
		socket.join(roomId);
		socket.broadcast.to(roomId).emit(SocketEvent.USER_JOINED, { user });
		const users = getUsersInRoom(roomId);
		io.to(socket.id).emit(SocketEvent.JOIN_ACCEPTED, { user, users });
	});

	socket.on("disconnecting", () => {
		const user = getUserBySocketId(socket.id);
		if (!user) return;
		const roomId = user.roomId;
		socket.broadcast.to(roomId).emit(SocketEvent.USER_DISCONNECTED, { user });
		userSocketMap = userSocketMap.filter((u) => u.socketId !== socket.id);
		socket.leave(roomId);

		if (getUsersInRoom(roomId).length === 0) {
			terminalManager.killRoomTerminals(roomId);
		}
	});

	socket.on(
		SocketEvent.SYNC_FILE_STRUCTURE,
		({ fileStructure, openFiles, activeFile, socketId }) => {
			io.to(socketId).emit(SocketEvent.SYNC_FILE_STRUCTURE, {
				fileStructure,
				openFiles,
				activeFile,
			});
		},
	);

	socket.on(SocketEvent.DIRECTORY_CREATED, ({ parentDirId, newDirectory }) => {
		const roomId = getRoomId(socket.id);
		if (!roomId) return;
		socket.broadcast.to(roomId).emit(SocketEvent.DIRECTORY_CREATED, {
			parentDirId,
			newDirectory,
		});
	});

	socket.on(SocketEvent.DIRECTORY_UPDATED, ({ dirId, children }) => {
		const roomId = getRoomId(socket.id);
		if (!roomId) return;
		socket.broadcast.to(roomId).emit(SocketEvent.DIRECTORY_UPDATED, {
			dirId,
			children,
		});
	});

	socket.on(SocketEvent.DIRECTORY_RENAMED, ({ dirId, newName }) => {
		const roomId = getRoomId(socket.id);
		if (!roomId) return;
		socket.broadcast.to(roomId).emit(SocketEvent.DIRECTORY_RENAMED, {
			dirId,
			newName,
		});
	});

	socket.on(SocketEvent.DIRECTORY_DELETED, ({ dirId }) => {
		const roomId = getRoomId(socket.id);
		if (!roomId) return;
		socket.broadcast.to(roomId).emit(SocketEvent.DIRECTORY_DELETED, { dirId });
	});

	socket.on(SocketEvent.FILE_CREATED, ({ parentDirId, newFile }) => {
		const roomId = getRoomId(socket.id);
		if (!roomId) return;
		socket.broadcast.to(roomId).emit(SocketEvent.FILE_CREATED, { parentDirId, newFile });
	});

	socket.on(SocketEvent.FILE_UPDATED, ({ fileId, newContent }) => {
		const roomId = getRoomId(socket.id);
		if (!roomId) return;
		socket.broadcast.to(roomId).emit(SocketEvent.FILE_UPDATED, {
			fileId,
			newContent,
		});
	});

	socket.on(SocketEvent.FILE_RENAMED, ({ fileId, newName }) => {
		const roomId = getRoomId(socket.id);
		if (!roomId) return;
		socket.broadcast.to(roomId).emit(SocketEvent.FILE_RENAMED, {
			fileId,
			newName,
		});
	});

	socket.on(SocketEvent.FILE_DELETED, ({ fileId }) => {
		const roomId = getRoomId(socket.id);
		if (!roomId) return;
		socket.broadcast.to(roomId).emit(SocketEvent.FILE_DELETED, { fileId });
	});

	socket.on(SocketEvent.USER_OFFLINE, ({ socketId }) => {
		userSocketMap = userSocketMap.map((user) => {
			if (user.socketId === socketId) {
				return { ...user, status: USER_CONNECTION_STATUS.OFFLINE };
			}
			return user;
		});
		const roomId = getRoomId(socketId);
		if (!roomId) return;
		socket.broadcast.to(roomId).emit(SocketEvent.USER_OFFLINE, { socketId });
	});

	socket.on(SocketEvent.USER_ONLINE, ({ socketId }) => {
		userSocketMap = userSocketMap.map((user) => {
			if (user.socketId === socketId) {
				return { ...user, status: USER_CONNECTION_STATUS.ONLINE };
			}
			return user;
		});
		const roomId = getRoomId(socketId);
		if (!roomId) return;
		socket.broadcast.to(roomId).emit(SocketEvent.USER_ONLINE, { socketId });
	});

	socket.on(SocketEvent.SEND_MESSAGE, ({ message }) => {
		const roomId = getRoomId(socket.id);
		if (!roomId) return;
		socket.broadcast.to(roomId).emit(SocketEvent.RECEIVE_MESSAGE, { message });
	});

	socket.on(
		SocketEvent.TYPING_START,
		({ cursorPosition, selectionStart, selectionEnd }) => {
			userSocketMap = userSocketMap.map((user) => {
				if (user.socketId === socket.id) {
					return {
						...user,
						typing: true,
						cursorPosition,
						selectionStart,
						selectionEnd,
					};
				}
				return user;
			});
			const user = getUserBySocketId(socket.id);
			if (!user) return;
			const roomId = user.roomId;
			socket.broadcast.to(roomId).emit(SocketEvent.TYPING_START, { user });
		},
	);

	socket.on(SocketEvent.TYPING_PAUSE, () => {
		userSocketMap = userSocketMap.map((user) => {
			if (user.socketId === socket.id) {
				return { ...user, typing: false };
			}
			return user;
		});
		const user = getUserBySocketId(socket.id);
		if (!user) return;
		const roomId = user.roomId;
		socket.broadcast.to(roomId).emit(SocketEvent.TYPING_PAUSE, { user });
	});

	socket.on(
		SocketEvent.CURSOR_MOVE,
		({ cursorPosition, selectionStart, selectionEnd }) => {
			userSocketMap = userSocketMap.map((user) => {
				if (user.socketId === socket.id) {
					return {
						...user,
						cursorPosition,
						selectionStart,
						selectionEnd,
					};
				}
				return user;
			});
			const user = getUserBySocketId(socket.id);
			if (!user) return;
			const roomId = user.roomId;
			socket.broadcast.to(roomId).emit(SocketEvent.CURSOR_MOVE, { user });
		},
	);

	socket.on(SocketEvent.REQUEST_DRAWING, () => {
		const roomId = getRoomId(socket.id);
		if (!roomId) return;
		socket.broadcast.to(roomId).emit(SocketEvent.REQUEST_DRAWING, { socketId: socket.id });
	});

	socket.on(SocketEvent.SYNC_DRAWING, ({ drawingData, socketId }) => {
		socket.broadcast.to(socketId).emit(SocketEvent.SYNC_DRAWING, { drawingData });
	});

	socket.on(SocketEvent.DRAWING_UPDATE, ({ snapshot }) => {
		const roomId = getRoomId(socket.id);
		if (!roomId) return;
		socket.broadcast.to(roomId).emit(SocketEvent.DRAWING_UPDATE, {
			snapshot,
		});
	});

	socket.on(TerminalSocketEvent.LIST, ({ roomId }) => {
		if (!socketIsInRoom(socket, roomId)) return;
		socket.emit(TerminalSocketEvent.LIST_RESULT, {
			sessions: terminalManager.getRoomSessionsInfo(roomId),
		});
	});

	socket.on(TerminalSocketEvent.CREATE, ({ roomId, terminalId, cols, rows }) => {
		if (!socketIsInRoom(socket, roomId)) return;
		if (typeof terminalId !== "string" || terminalId.length === 0) return;

		try {
			const session = terminalManager.createTerminal(
				roomId,
				terminalId,
				{ cols, rows },
				(data) => {
					io.to(roomId).emit(TerminalSocketEvent.OUTPUT, { terminalId, data });
				},
				({ exitCode, signal }) => {
					io.to(roomId).emit(TerminalSocketEvent.CLOSED, { terminalId, exitCode, signal });
				},
			);

			socket.emit(TerminalSocketEvent.CREATED, {
				terminalId,
				history: session.history,
			});
		} catch (err) {
			socket.emit(TerminalSocketEvent.ERROR, { terminalId, message: err.message });
		}
	});

	socket.on(TerminalSocketEvent.INPUT, ({ roomId, terminalId, data }) => {
		if (!socketIsInRoom(socket, roomId)) return;
		if (typeof terminalId !== "string" || typeof data !== "string") return;
		terminalManager.writeToTerminal(roomId, terminalId, data);
	});

	socket.on(TerminalSocketEvent.RESIZE, ({ roomId, terminalId, cols, rows }) => {
		if (!socketIsInRoom(socket, roomId)) return;
		if (typeof terminalId !== "string") return;
		terminalManager.resizeTerminal(roomId, terminalId, cols, rows);
	});

	socket.on(TerminalSocketEvent.CLOSE, ({ roomId, terminalId }) => {
		if (!socketIsInRoom(socket, roomId)) return;
		if (typeof terminalId !== "string") return;
		const closed = terminalManager.closeTerminal(roomId, terminalId);
		if (closed) {
			io.to(roomId).emit(TerminalSocketEvent.CLOSED, {
				terminalId,
				exitCode: null,
				signal: null,
			});
		}
	});
});

const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
	res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

server.listen(PORT, () => {
	console.log(`Listening on port ${PORT}`);
});